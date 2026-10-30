import net from 'node:net';
import { automationError } from './aliyun-client.js';
import { assertDdnsTaskReady, appendDdnsLog, DDNS_PROVIDERS, legacyView, normalizeDdns } from './ddns-schema.js';
import { createDdnsClient } from './ddns-providers.js';
import { resolveIp, resolveFromUrls, listNetworkInterfaces } from './ddns-ip.js';

function redact(message, secrets = []) {
  let out = String(message);
  for (const secret of secrets.filter(Boolean)) out = out.split(secret).join('[已隐藏]');
  return out;
}

function secretsOf(task) {
  const c = task.credentials || {};
  return [c.apiToken, c.accessKeySecret, c.secretKey, c.secret, c.password, c.token, c.apiKey, c.secretApiKey];
}

function replaceWebhook(template, vars) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars)) out = out.split(`#{${key}}`).join(String(value ?? ''));
  return out;
}

export class DdnsService {
  constructor({ store, logger, demoMode = false, fetchFn = globalThis.fetch, clientFactory = createDdnsClient }) {
    Object.assign(this, { store, logger, demoMode, fetchFn, clientFactory });
    this.running = null;
    this.detecting = new Map();
    this.detections = {};
    this.ipHits = new Map();
  }

  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref?.();
    this.initial = setTimeout(() => void this.tick(), 10_000);
    this.initial.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.initial);
  }

  interfaces() { return listNetworkInterfaces(); }

  sync(options = {}) {
    if (!this.running) this.running = this.perform(options).finally(() => { this.running = null; });
    return this.running;
  }

  test(options = {}) { return this.sync({ ...options, checkOnly: true }); }

  detectionStatus() { return { results: { ...this.detections }, running: [...this.detecting.keys()] }; }

  detect(recordType = 'A', stack) {
    if (!['A', 'AAAA'].includes(recordType)) return Promise.reject(automationError('请选择 A（IPv4）或 AAAA（IPv6）', 400));
    const key = `${recordType}:${stack?.getType || 'url'}:${(stack?.urls || []).join(',')}:${stack?.netInterface || ''}:${stack?.command || ''}`;
    if (!this.detecting.has(key)) {
      const task = this.detectAddress(recordType, stack).finally(() => this.detecting.delete(key));
      this.detecting.set(key, task);
    }
    return this.detecting.get(key);
  }

  async detectAddress(recordType, stack) {
    if (this.demoMode) return { demoMode: true, recordType, source: 'demo', message: '演示模式不检测真实公网 IP；安装到 NAS 后由 NAS 自动获取出口地址' };
    try {
      const resolved = stack
        ? await resolveIp(stack, recordType, { fetchFn: this.fetchFn })
        : await resolveFromUrls(recordType, undefined, { fetchFn: this.fetchFn });
      const result = { ...resolved, detectedAt: new Date().toISOString(), error: null };
      this.detections[recordType] = result;
      return result;
    } catch (error) {
      const message = error.status ? String(error.message) : `公网 IPv${recordType === 'AAAA' ? '6' : '4'} 检测失败`;
      this.detections[recordType] = { ...this.detections[recordType], recordType, error: message, attemptedAt: new Date().toISOString() };
      throw automationError(message, error.status || 502);
    }
  }

  log(level, message) {
    if (typeof this.store.appendDdnsLogEntry === 'function') {
      this.store.appendDdnsLogEntry({ level, message });
      return;
    }
    const config = appendDdnsLog(this.store.ddnsConfig(), { level, message });
    this.store.data.integrations.ddns = config;
    this.store.save();
  }

  async fireWebhook(summary) {
    const config = normalizeDdns(this.store.ddnsConfig());
    const webhook = config.webhook;
    if (!webhook?.enabled || !webhook.url) return;
    const vars = {
      ipv4Addr: summary.ipv4Addr || '',
      ipv4Result: summary.ipv4Result || '未改变',
      ipv4Domains: (summary.ipv4Domains || []).join(','),
      ipv6Addr: summary.ipv6Addr || '',
      ipv6Result: summary.ipv6Result || '未改变',
      ipv6Domains: (summary.ipv6Domains || []).join(','),
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const url = replaceWebhook(webhook.url, vars);
    const body = replaceWebhook(webhook.requestBody, vars);
    const headers = {};
    for (const line of String(webhook.headers || '').split(/\n+/)) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    try {
      const method = body ? 'POST' : 'GET';
      if (body && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = (() => { try { JSON.parse(body); return 'application/json'; } catch { return 'application/x-www-form-urlencoded'; } })();
      }
      const response = await this.fetchFn(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) this.log('warn', `Webhook 返回 HTTP ${response.status}`);
    } catch (error) {
      this.log('warn', `Webhook 调用失败：${redact(error.message)}`);
    }
  }

  async syncTask(task, { checkOnly = false, publicIp, publicIpv6 } = {}) {
    assertDdnsTaskReady(task);
    if (this.demoMode) return { demoMode: true, taskId: task.id, message: '演示模式不修改 DNS，也不记录真实同步成功' };
    const client = this.clientFactory(task, { fetchFn: this.fetchFn });
    const summary = { ipv4Addr: '', ipv4Result: '未改变', ipv4Domains: [], ipv6Addr: '', ipv6Result: '未改变', ipv6Domains: [] };
    const onlyV6 = task.ipv6?.enabled && !task.ipv4?.enabled;
    const stacks = [
      ['A', 'ipv4', publicIp, 'lastIpv4', 'ipv4Addr', 'ipv4Result', 'ipv4Domains'],
      ['AAAA', 'ipv6', publicIpv6 ?? (onlyV6 ? publicIp : undefined), 'lastIpv6', 'ipv6Addr', 'ipv6Result', 'ipv6Domains'],
    ];
    let changedAny = false;
    let lastIp = null;
    const pending = { lastIpv4: null, lastIpv6: null };

    if (checkOnly) {
      const domains = [...(task.ipv4.enabled ? task.ipv4.domains.map((name) => ({ name, type: 'A' })) : []), ...(task.ipv6.enabled ? task.ipv6.domains.map((name) => ({ name, type: 'AAAA' })) : [])];
      const sample = domains[0];
      const record = sample ? await client.inspect({ type: sample.type, name: sample.name }) : null;
      return { ok: true, taskId: task.id, recordExists: Boolean(record), message: `${DDNS_PROVIDERS[task.provider]} 查询正常${record ? '，已找到目标记录' : '，同步时将创建记录'}；写权限需在实际同步时验证` };
    }

    for (const [type, stackKey, forcedIp, lastKey, addrKey, resultKey, domainsKey] of stacks) {
      const stack = task[stackKey];
      if (!stack?.enabled) continue;
      let ip = forcedIp;
      if (!ip) ip = (await this.detect(type, stack)).ip;
      if (net.isIP(ip) !== (type === 'AAAA' ? 6 : 4)) throw automationError('公网检测返回的 IP 类型与 DNS 记录类型不符', 502);
      summary[addrKey] = ip;
      summary[domainsKey] = stack.domains;
      lastIp = ip;
      pending[lastKey] = ip;
      let stackResult = '未改变';
      const previous = task[lastKey];
      for (const name of stack.domains) {
        const result = await client.upsert({
          type, name, content: ip, ttl: task.ttl,
          proxied: task.provider === 'cloudflare' && task.credentials.proxied,
          customParams: task.customParams,
          previous,
        });
        if (result.changed) { changedAny = true; stackResult = '成功'; }
      }
      summary[resultKey] = stackResult;
    }

    this.store.recordDdnsResult({
      ok: true,
      taskId: task.id,
      ip: lastIp,
      ipv4: pending.lastIpv4,
      ipv6: pending.lastIpv6,
      changed: changedAny,
    });
    this.log('info', `任务 ${task.name || task.id} 同步完成：IPv4 ${summary.ipv4Result} / IPv6 ${summary.ipv6Result}`);
    if (changedAny) this.logger?.info('DDNS 记录已更新', { provider: task.provider, taskId: task.id });
    await this.fireWebhook(summary);
    return { ok: true, provider: task.provider, taskId: task.id, changed: changedAny, ip: lastIp, summary };
  }

  async perform({ publicIp, publicIpv6, checkOnly = false, taskId, taskIds, forcedByTask } = {}) {
    const config = normalizeDdns(this.store.ddnsConfig());
    let selected;
    if (Array.isArray(taskIds) && taskIds.length) {
      const wanted = new Set(taskIds);
      selected = config.tasks.filter((task) => wanted.has(task.id));
    } else if (taskId) {
      selected = config.tasks.filter((task) => task.id === taskId);
    } else {
      selected = config.tasks.filter((task) => checkOnly || task.enabled || config.tasks.length === 1);
    }
    if (!selected.length && config.tasks[0] && !taskId && !taskIds) selected = [config.tasks[0]];
    if (!selected.length) throw automationError('请先添加并保存 DDNS 任务', 400);
    const results = [];
    try {
      for (const task of selected) {
        const forced = forcedByTask?.[task.id] || {};
        try {
          results.push(await this.syncTask(task, {
            checkOnly,
            publicIp: forced.publicIp ?? publicIp,
            publicIpv6: forced.publicIpv6 ?? publicIpv6,
          }));
        } catch (error) {
          const message = redact(error.status ? error.message : 'DDNS 请求失败或超时，请检查网络后重试', secretsOf(task));
          if (!checkOnly) this.store.recordDdnsResult({ ok: false, taskId: task.id, error: message });
          this.log('error', `任务 ${task.name || task.id} 失败：${message}`);
          this.logger?.warn(checkOnly ? 'DDNS 连接测试失败' : 'DDNS 同步失败', { provider: task.provider, error: message });
          if (selected.length === 1) throw automationError(message, error.status || 502);
          results.push({ ok: false, taskId: task.id, error: message });
        }
      }
      return selected.length === 1 ? results[0] : { ok: results.every((item) => item.ok !== false), results };
    } catch (error) {
      if (error.status) throw error;
      throw automationError(String(error.message || 'DDNS 请求失败'), 502);
    }
  }

  async tick() {
    if (this.demoMode || this.running) return;
    const config = normalizeDdns(this.store.ddnsConfig());
    const due = config.tasks.filter((task) => task.enabled && (!task.lastRunAt || Date.now() - Date.parse(task.lastRunAt) >= config.intervalSeconds * 1000));
    if (!due.length) return;

    const readyIds = [];
    const forcedByTask = {};
    for (const task of due) {
      let ready = true;
      const forced = {};
      for (const [type, stackKey, forceKey] of [['A', 'ipv4', 'publicIp'], ['AAAA', 'ipv6', 'publicIpv6']]) {
        const stack = task[stackKey];
        if (!stack?.enabled) continue;
        try {
          const detected = await this.detect(type, stack);
          const key = `${task.id}:${type}`;
          const prev = this.ipHits.get(key) || { ip: null, hits: 0 };
          if (prev.ip === detected.ip) prev.hits += 1;
          else { prev.ip = detected.ip; prev.hits = 1; }
          this.ipHits.set(key, prev);
          if (prev.hits < config.cacheTimes) { ready = false; break; }
          forced[forceKey] = detected.ip;
        } catch {
          ready = false;
          break;
        }
      }
      if (ready) {
        readyIds.push(task.id);
        forcedByTask[task.id] = forced;
      }
    }
    if (!readyIds.length) return;
    try {
      await this.sync({ taskIds: readyIds, forcedByTask });
    } catch { /* logged in perform */ }
  }
}

export { legacyView };
