import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { publicIpEndpoint } from './cloudflare-dns.js';
import { automationError } from './aliyun-client.js';

const familyOf = (recordType) => (recordType === 'AAAA' ? 6 : 4);

export function isPublicAddress(ip, recordType) {
  if (net.isIP(ip) !== familyOf(recordType)) return false;
  if (recordType === 'A') {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && [18, 19].includes(b)) return false;
    return true;
  }
  return /^[23]/i.test(ip);
}

export function listNetworkInterfaces() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      result.push({
        name,
        address: entry.address,
        family: entry.family === 'IPv6' || entry.family === 6 ? 'IPv6' : 'IPv4',
        mac: entry.mac || '',
      });
    }
  }
  return result;
}

function matchInterface(name, pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return false;
  if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const end = raw.lastIndexOf('/');
    try { return new RegExp(raw.slice(1, end), raw.slice(end + 1)).test(name); } catch { return false; }
  }
  return name === raw || name.toLowerCase() === raw.toLowerCase();
}

export function resolveFromInterfaces(recordType, pattern) {
  const family = familyOf(recordType);
  for (const item of listNetworkInterfaces()) {
    if (!matchInterface(item.name, pattern)) continue;
    if (net.isIP(item.address) !== family) continue;
    if (!isPublicAddress(item.address, recordType) && recordType === 'AAAA' && !/^[23]/i.test(item.address)) continue;
    if (recordType === 'A' && !isPublicAddress(item.address, 'A')) continue;
    if (recordType === 'AAAA' && !isPublicAddress(item.address, 'AAAA')) continue;
    return { ip: item.address, source: `net:${item.name}`, recordType };
  }
  throw automationError(`网卡「${pattern}」未找到可用的公网 IPv${family === 6 ? '6' : '4'} 地址`, 502);
}

function extractIp(text, recordType) {
  const family = familyOf(recordType);
  const v4 = text.match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g) || [];
  const v6 = text.match(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi) || [];
  for (const candidate of family === 4 ? v4 : v6) {
    if (isPublicAddress(candidate, recordType)) return candidate;
  }
  return null;
}

export function resolveFromCommand(recordType, command, { timeoutMs = 10_000, spawnFn = spawn } = {}) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return Promise.reject(automationError('取 IP 命令不能为空', 400));
  if (trimmed.length > 500) return Promise.reject(automationError('取 IP 命令过长', 400));
  return new Promise((resolve, reject) => {
    const child = spawnFn('/bin/sh', ['-c', trimmed], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(automationError('取 IP 命令超时', 504)); }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 64_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => { clearTimeout(timer); reject(automationError('无法执行取 IP 命令', 502)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const ip = extractIp(`${stdout}\n${stderr}`, recordType);
      if (!ip) return reject(automationError(`命令未返回有效公网 IPv${recordType === 'AAAA' ? '6' : '4'}${code ? `（退出码 ${code}）` : ''}`, 502));
      resolve({ ip, source: 'command', recordType });
    });
  });
}

async function readResponseBody(response) {
  if (typeof response.text === 'function') {
    try { return await response.text(); } catch { /* some mocks only implement json() */ }
  }
  if (typeof response.json === 'function') {
    try { return JSON.stringify(await response.json()); } catch { return ''; }
  }
  return '';
}

async function fetchIpFromUrl(url, recordType, fetchFn) {
  const response = await fetchFn(url, { headers: { Accept: 'application/json,text/plain,*/*' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('response');
  const contentType = String(response.headers?.get?.('content-type') || '');
  const body = await readResponseBody(response);
  let ip = '';
  if (/json/i.test(contentType) || body.trim().startsWith('{')) {
    try {
      const json = JSON.parse(body);
      ip = String(json.ip || json.origin || json.address || json.query || '').trim();
    } catch { /* fall through */ }
  }
  if (!ip) ip = extractIp(body, recordType) || '';
  if (!isPublicAddress(ip, recordType)) throw new Error('family');
  return { ip, source: new URL(url).hostname, recordType };
}

export async function resolveFromUrls(recordType, urls = [], { fetchFn = globalThis.fetch } = {}) {
  const list = (Array.isArray(urls) && urls.length ? urls : [publicIpEndpoint(recordType)]).map((item) => {
    const value = String(item || '').trim();
    if (!value) return '';
    if (value.includes('://')) return value;
    return value;
  }).filter(Boolean);
  let lastError = null;
  for (const url of list) {
    try {
      return await fetchIpFromUrl(url.includes('://') ? url : `https://${url}`, recordType, fetchFn);
    } catch (error) {
      lastError = error;
    }
  }
  const source = list[0] ? (() => { try { return new URL(list[0].includes('://') ? list[0] : `https://${list[0]}`).hostname; } catch { return list[0]; } })() : 'ipify';
  throw automationError(`公网 IPv${recordType === 'AAAA' ? '6' : '4'} 检测失败，请检查 NAS 网络及 ${source} 可达性${recordType === 'AAAA' ? '，并确认网络支持 IPv6' : ''}${lastError ? '' : ''}`, 502);
}

export async function resolveIp(stack, recordType, options = {}) {
  if (!stack?.enabled) throw automationError('该地址类型未启用', 400);
  if (stack.getType === 'netInterface') return resolveFromInterfaces(recordType, stack.netInterface);
  if (stack.getType === 'command') return resolveFromCommand(recordType, stack.command, options);
  return resolveFromUrls(recordType, stack.urls, options);
}
