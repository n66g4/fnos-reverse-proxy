import net from 'node:net';
import { automationError } from './aliyun-client.js';
import { validDomain } from './ddns-schema.js';

const clean = (value) => String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
export const invalidDnsResponse = () => automationError('DNS 查询响应不完整，已停止写入；请稍后重试', 502);

export function relativeRecord(name, zone) {
  name = clean(name); zone = clean(zone);
  if (!validDomain(name) || !validDomain(zone) || name !== zone && !name.endsWith(`.${zone}`)) throw automationError('完整记录名称必须属于所填 DNS 主域名');
  return name === zone ? '@' : name.slice(0, -(zone.length + 1));
}

export function sameIp(left, right) {
  if (!net.isIP(left) || net.isIP(left) !== net.isIP(right)) return false;
  return net.isIP(left) === 6 ? new URL(`http://[${left}]/`).hostname === new URL(`http://[${right}]/`).hostname : left === right;
}

export function safeDnsError(error, label) {
  const code = String(error?.code || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  const requestId = String(error?.data?.RequestId || error?.requestId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80);
  return automationError(`${label}请求失败${code ? `（${code}）` : '（网络超时或服务暂不可用）'}${requestId ? `，请求 ID：${requestId}` : ''}；请检查 DNS 权限、凭据、主域名、线路和 TTL`, 502);
}

export function selectRecord(records, { rr, type, line }) {
  const named = records.filter((record) => clean(record.name) === clean(rr));
  if (named.some((record) => ['CNAME', 'NS', 'REDIRECT_URL', 'FORWARD_URL', '显性URL', '隐性URL'].includes(record.type) && !(rr === '@' && record.type === 'NS'))) {
    throw automationError('同名 DNS 记录存在 CNAME、委派或 URL 转发冲突，不会覆盖原记录', 409);
  }
  const matching = named.filter((record) => record.type === type && record.line === line);
  if (matching.length > 1) throw automationError('同名、同类型、同线路存在多条解析，请先在云端整理；不会任选一条覆盖', 409);
  const record = matching[0];
  if (record && (!record.id || !record.value || !Number.isFinite(record.ttl))) throw invalidDnsResponse();
  if (record && (record.status?.toUpperCase() !== 'ENABLE' || record.locked || record.weight > 0)) {
    throw automationError('目标解析已暂停、锁定或配置了负载均衡，请先在云端处理', 409);
  }
  return record || null;
}
