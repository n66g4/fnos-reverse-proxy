import net from 'node:net';
import { automationError } from './aliyun-client.js';
import { relativeRecord, sameIp } from './ddns-providers-core.js';

const clean = (value) => String(value ?? '').trim();
const fail = (message, status = 502) => { throw automationError(message, status); };

async function request(fetchFn, url, { method = 'GET', headers = {}, body, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, {
      method,
      headers,
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    if (error?.name === 'AbortError') fail('DNS API 请求超时');
    fail(`无法连接 DNS API：${clean(error?.message) || '网络错误'}`);
  } finally {
    clearTimeout(timer);
  }
}

function replaceVars(template, vars) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars)) out = out.split(`#{${key}}`).join(String(value ?? ''));
  return out;
}

export class CallbackDdnsClient {
  constructor(credentials, { fetchFn = globalThis.fetch } = {}) {
    this.credentials = credentials;
    this.fetchFn = fetchFn;
  }
  async inspect() { return null; }
  async upsert({ name, type, content, ttl, previous }) {
    if (previous && sameIp(previous, content)) return { changed: false };
    const vars = {
      ip: content, domain: name, recordType: type, ttl: String(ttl || 600),
      ipv4Addr: type === 'A' ? content : '', ipv6Addr: type === 'AAAA' ? content : '',
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const url = replaceVars(this.credentials.url, vars);
    const body = replaceVars(this.credentials.requestBody, vars);
    const headers = {};
    for (const line of String(this.credentials.headers || '').split(/\n+/)) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    const method = body ? 'POST' : 'GET';
    if (body && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = (() => { try { JSON.parse(body); return 'application/json'; } catch { return 'application/x-www-form-urlencoded'; } })();
    }
    const result = await request(this.fetchFn, url, { method, headers, body: body || undefined });
    if (!result.ok) fail(`Callback 调用失败（HTTP ${result.status}）`);
    return { changed: true };
  }
}

/** Generic helpers for providers that expose simple REST upsert semantics. */
class HttpJsonClient {
  constructor(credentials, { fetchFn = globalThis.fetch } = {}) {
    this.credentials = credentials;
    this.fetchFn = fetchFn;
  }
  async inspect() { return null; }
}

export class PorkbunDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const zone = this.credentials.dnsZone || name.split('.').slice(-2).join('.');
    const sub = relativeRecord(name, zone) === '@' ? '' : relativeRecord(name, zone);
    const auth = { apikey: this.credentials.id, secretapikey: this.credentials.secret || this.credentials.secretApiKey };
    const retrieve = await request(this.fetchFn, `https://api.porkbun.com/api/json/v3/dns/retrieveByNameType/${zone}/${type}/${sub}`, { method: 'POST', body: auth, headers: { 'Content-Type': 'application/json' } });
    if (!retrieve.ok || retrieve.json?.status !== 'SUCCESS') fail(`Porkbun 查询失败：${retrieve.text.slice(0, 200)}`);
    const records = retrieve.json.records || [];
    if (records.length && sameIp(records[0].content, content) && String(records[0].ttl) === String(ttl || 600)) return { changed: false };
    const path = records.length
      ? `https://api.porkbun.com/api/json/v3/dns/editByNameType/${zone}/${type}/${sub}`
      : `https://api.porkbun.com/api/json/v3/dns/create/${zone}`;
    const body = { ...auth, type, content, ttl: String(ttl || 600), ...(records.length ? {} : { name: sub }) };
    const saved = await request(this.fetchFn, path, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    if (!saved.ok || saved.json?.status !== 'SUCCESS') fail(`Porkbun 更新失败：${saved.text.slice(0, 200)}`);
    return { changed: true };
  }
}

export class GoDaddyDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const zone = this.credentials.dnsZone || name.split('.').slice(-2).join('.');
    const sub = relativeRecord(name, zone);
    const headers = {
      Authorization: `sso-key ${this.credentials.id}:${this.credentials.secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const url = `https://api.godaddy.com/v1/domains/${encodeURIComponent(zone)}/records/${type}/${encodeURIComponent(sub === '@' ? '@' : sub)}`;
    const result = await request(this.fetchFn, url, {
      method: 'PUT',
      headers,
      body: [{ data: content, name: sub === '@' ? '@' : sub, ttl: Number(ttl) || 600, type }],
    });
    if (!result.ok) fail(`GoDaddy 更新失败（HTTP ${result.status}）`);
    return { changed: true };
  }
}

export class NamecheapDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content }) {
    if (type !== 'A' && type !== 'AAAA') fail('Namecheap DDNS 仅支持 A/AAAA');
    const zone = this.credentials.dnsZone;
    const host = relativeRecord(name, zone);
    const url = new URL('https://dynamicdns.park-your-domain.com/update');
    url.searchParams.set('host', host === '@' ? '@' : host);
    url.searchParams.set('domain', zone);
    url.searchParams.set('password', this.credentials.password);
    url.searchParams.set('ip', content);
    const result = await request(this.fetchFn, url.toString());
    if (!result.ok || /error|Err/i.test(result.text)) fail(`Namecheap 更新失败：${result.text.slice(0, 200)}`);
    return { changed: true };
  }
}

export class NameSiloDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const zone = this.credentials.dnsZone || name.split('.').slice(-2).join('.');
    const listUrl = new URL('https://www.namesilo.com/api/dnsListRecords');
    listUrl.searchParams.set('version', '1');
    listUrl.searchParams.set('type', 'xml');
    listUrl.searchParams.set('key', this.credentials.secret || this.credentials.id);
    listUrl.searchParams.set('domain', zone);
    const listed = await request(this.fetchFn, listUrl.toString());
    if (!listed.ok) fail('NameSilo 查询失败');
    const rr = relativeRecord(name, zone);
    const match = [...listed.text.matchAll(/<record>[\s\S]*?<rrid>(\d+)<\/rrid>[\s\S]*?<type>([^<]+)<\/type>[\s\S]*?<host>([^<]+)<\/host>[\s\S]*?<value>([^<]+)<\/value>[\s\S]*?<\/record>/gi)]
      .map((item) => ({ id: item[1], type: item[2], host: item[3], value: item[4] }))
      .find((item) => item.type === type && (item.host === name || item.host === rr || (rr === '@' && item.host === zone)));
    if (match && sameIp(match.value, content)) return { changed: false };
    const action = match ? 'dnsUpdateRecord' : 'dnsAddRecord';
    const url = new URL(`https://www.namesilo.com/api/${action}`);
    url.searchParams.set('version', '1');
    url.searchParams.set('type', 'xml');
    url.searchParams.set('key', this.credentials.secret || this.credentials.id);
    url.searchParams.set('domain', zone);
    url.searchParams.set('rrtype', type);
    url.searchParams.set('rrhost', rr === '@' ? '' : rr);
    url.searchParams.set('rrvalue', content);
    url.searchParams.set('rrttl', String(ttl || 7207));
    if (match) url.searchParams.set('rrid', match.id);
    const saved = await request(this.fetchFn, url.toString());
    if (!saved.ok || /<code>(?!300)/.test(saved.text)) fail(`NameSilo 更新失败：${saved.text.slice(0, 200)}`);
    return { changed: true };
  }
}

export class DeSecDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const zone = this.credentials.dnsZone || name.split('.').slice(-2).join('.');
    const headers = { Authorization: `Token ${this.credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    const list = await request(this.fetchFn, `https://desec.io/api/v1/domains/${encodeURIComponent(zone)}/rrsets/${encodeURIComponent(name)}./${type}/`, { headers });
    if (list.status === 404) {
      const created = await request(this.fetchFn, `https://desec.io/api/v1/domains/${encodeURIComponent(zone)}/rrsets/`, {
        method: 'POST', headers, body: { subname: relativeRecord(name, zone) === '@' ? '' : relativeRecord(name, zone), type, ttl: Number(ttl) || 3600, records: [`${content}`] },
      });
      if (!created.ok) fail(`deSEC 创建失败（HTTP ${created.status}）`);
      return { changed: true };
    }
    if (!list.ok) fail(`deSEC 查询失败（HTTP ${list.status}）`);
    const records = list.json?.records || [];
    if (records.some((item) => sameIp(String(item).replace(/\.$/, ''), content))) return { changed: false };
    const saved = await request(this.fetchFn, `https://desec.io/api/v1/domains/${encodeURIComponent(zone)}/rrsets/${encodeURIComponent(name)}./${type}/`, {
      method: 'PATCH', headers, body: { ttl: Number(ttl) || 3600, records: [`${content}`] },
    });
    if (!saved.ok) fail(`deSEC 更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class DynadotDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content }) {
    const url = new URL('https://api.dynadot.com/api3.json');
    url.searchParams.set('key', this.credentials.secret || this.credentials.id);
    url.searchParams.set('command', 'set_dns2');
    url.searchParams.set('domain', this.credentials.dnsZone || name);
    url.searchParams.set(type === 'AAAA' ? 'main_record_type2' : 'main_record_type0', type);
    url.searchParams.set(type === 'AAAA' ? 'main_record2' : 'main_record0', content);
    const result = await request(this.fetchFn, url.toString());
    if (!result.ok) fail(`Dynadot 更新失败（HTTP ${result.status}）`);
    return { changed: true };
  }
}

export class DnslaDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const auth = Buffer.from(`${this.credentials.id}:${this.credentials.secret}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
    const zone = this.credentials.dnsZone;
    const list = await request(this.fetchFn, `https://api.dns.la/api/recordList?domain=${encodeURIComponent(zone)}&page=1&pageSize=100`, { headers });
    if (!list.ok) fail(`DNSLA 查询失败（HTTP ${list.status}）`);
    const rr = relativeRecord(name, zone);
    const records = list.json?.data?.list || list.json?.data || [];
    const found = (Array.isArray(records) ? records : []).find((item) => String(item.type).toUpperCase() === type && (item.host === rr || item.host === name));
    if (found && sameIp(found.data, content)) return { changed: false };
    const body = { domain: zone, host: rr === '@' ? '' : rr, type, data: content, ttl: Number(ttl) || 600, ...(found ? { id: found.id } : {}) };
    const saved = await request(this.fetchFn, found ? 'https://api.dns.la/api/recordUpdate' : 'https://api.dns.la/api/recordCreate', { method: 'POST', headers, body });
    if (!saved.ok) fail(`DNSLA 更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class GcoreDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const headers = { Authorization: `APIKey ${this.credentials.apiKey}`, 'Content-Type': 'application/json' };
    const zone = this.credentials.dnsZone;
    const list = await request(this.fetchFn, `https://api.gcore.com/dns/v2/zones/${encodeURIComponent(zone)}/rrsets?name=${encodeURIComponent(name)}&type=${type}`, { headers });
    if (!list.ok) fail(`Gcore 查询失败（HTTP ${list.status}）`);
    const rrsets = list.json?.rrsets || list.json || [];
    const found = (Array.isArray(rrsets) ? rrsets : []).find((item) => item.type === type);
    if (found?.resource_records?.some((item) => sameIp(item.content?.[0] || item.content, content))) return { changed: false };
    const body = { ttl: Number(ttl) || 300, resource_records: [{ content: [content] }] };
    const path = `https://api.gcore.com/dns/v2/zones/${encodeURIComponent(zone)}/rrsets/${encodeURIComponent(name)}/${type}`;
    const saved = await request(this.fetchFn, path, { method: found ? 'PUT' : 'POST', headers, body });
    if (!saved.ok) fail(`Gcore 更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class NsOneDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const headers = { 'X-NSONE-Key': this.credentials.apiKey, 'Content-Type': 'application/json' };
    const zone = this.credentials.dnsZone;
    const get = await request(this.fetchFn, `https://api.nsone.net/v1/zones/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/${type}`, { headers });
    if (get.status === 404) {
      const created = await request(this.fetchFn, `https://api.nsone.net/v1/zones/${encodeURIComponent(zone)}`, {
        method: 'PUT', headers, body: { zone, records: [{ domain: name, type, answers: [{ answer: [content] }], ttl: Number(ttl) || 60 }] },
      });
      if (!created.ok) {
        const add = await request(this.fetchFn, `https://api.nsone.net/v1/zones/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/${type}`, {
          method: 'PUT', headers, body: { answers: [{ answer: [content] }], ttl: Number(ttl) || 60 },
        });
        if (!add.ok) fail(`NS1 创建失败（HTTP ${add.status}）`);
      }
      return { changed: true };
    }
    if (!get.ok) fail(`NS1 查询失败（HTTP ${get.status}）`);
    const answers = get.json?.answers || [];
    if (answers.some((item) => sameIp(String(item.answer?.[0] || item.answer), content))) return { changed: false };
    const saved = await request(this.fetchFn, `https://api.nsone.net/v1/zones/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/${type}`, {
      method: 'POST', headers, body: { answers: [{ answer: [content] }], ttl: Number(ttl) || 60 },
    });
    if (!saved.ok) fail(`NS1 更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class RainyunDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const headers = { 'X-Api-Key': this.credentials.apiKey, 'Content-Type': 'application/json' };
    const zone = this.credentials.dnsZone;
    const list = await request(this.fetchFn, `https://api.v2.rainyun.com/product/domain/${encodeURIComponent(zone)}/dns`, { headers });
    if (!list.ok) fail(`雨云查询失败（HTTP ${list.status}）`);
    const records = list.json?.data || list.json || [];
    const rr = relativeRecord(name, zone);
    const found = (Array.isArray(records) ? records : []).find((item) => String(item.type).toUpperCase() === type && (item.host === rr || item.host === name));
    if (found && sameIp(found.value || found.data, content)) return { changed: false };
    const body = { host: rr === '@' ? '@' : rr, type, value: content, ttl: Number(ttl) || 300, ...(found ? { id: found.id } : {}) };
    const saved = await request(this.fetchFn, `https://api.v2.rainyun.com/product/domain/${encodeURIComponent(zone)}/dns${found ? `/${found.id}` : ''}`, {
      method: found ? 'PUT' : 'POST', headers, body,
    });
    if (!saved.ok) fail(`雨云更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

/** Providers that mainly use id/secret URL templates similar to ddns-go Callback-style APIs. */
export class GenericUrlDdnsClient extends HttpJsonClient {
  constructor(credentials, { fetchFn, buildUrl }) {
    super(credentials, { fetchFn });
    this.buildUrl = buildUrl;
  }
  async upsert({ name, type, content, ttl }) {
    const url = this.buildUrl({ credentials: this.credentials, name, type, content, ttl });
    const result = await request(this.fetchFn, url);
    if (!result.ok) fail(`DNS 更新失败（HTTP ${result.status}）`);
    return { changed: true };
  }
}

export function createNowcnClient(credentials, options) {
  return new GenericUrlDdnsClient(credentials, {
    ...options,
    buildUrl: ({ credentials: c, name, content }) => {
      const url = new URL('https://api.now.cn/api/dnsRecordModify');
      url.searchParams.set('username', c.id);
      url.searchParams.set('password', c.secret);
      url.searchParams.set('domain', c.dnsZone || name);
      url.searchParams.set('host', relativeRecord(name, c.dnsZone || name));
      url.searchParams.set('value', content);
      return url.toString();
    },
  });
}

export function createEranetClient(credentials, options) {
  return new GenericUrlDdnsClient(credentials, {
    ...options,
    buildUrl: ({ credentials: c, name, content }) => {
      const url = new URL('https://www.eranet.com/api/dns/update');
      url.searchParams.set('token', c.secret || c.id);
      url.searchParams.set('domain', name);
      url.searchParams.set('ip', content);
      return url.toString();
    },
  });
}

export function createTnethkClient(credentials, options) {
  return new GenericUrlDdnsClient(credentials, {
    ...options,
    buildUrl: ({ credentials: c, name, content }) => {
      const url = new URL('https://api.tnet.hk/dns/update');
      url.searchParams.set('key', c.secret || c.id);
      url.searchParams.set('hostname', name);
      url.searchParams.set('myip', content);
      return url.toString();
    },
  });
}

export class HuaweiDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    // Project token auth: id=projectId, secret=X-Auth-Token, dnsZone=zone id.
    const token = this.credentials.secret || this.credentials.token || this.credentials.accessKeySecret;
    const projectId = this.credentials.id || this.credentials.projectId || this.credentials.accessKeyId;
    const zoneId = this.credentials.dnsZone;
    if (!token || !projectId || !zoneId) fail('华为云请在凭据中填写项目 ID、Token 与 Zone ID');
    const headers = { 'X-Auth-Token': token, 'Content-Type': 'application/json' };
    const base = `https://dns.myhuaweicloud.com/v2/zones/${encodeURIComponent(zoneId)}/recordsets`;
    const list = await request(this.fetchFn, `${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers });
    if (!list.ok) fail(`华为云查询失败（HTTP ${list.status}）`);
    const found = (list.json?.recordsets || [])[0];
    if (found && (found.records || []).some((item) => sameIp(item, content))) return { changed: false };
    const body = { name: name.endsWith('.') ? name : `${name}.`, type, records: [content], ttl: Number(ttl) || 300 };
    const saved = await request(this.fetchFn, found ? `${base}/${found.id}` : base, { method: found ? 'PUT' : 'POST', headers, body });
    if (!saved.ok) fail(`华为云更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class BaiduDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    const headers = {
      Authorization: `Bearer ${this.credentials.accessKeySecret}`,
      'Content-Type': 'application/json',
    };
    // Baidu DNS OpenAPI typically needs BCE signing; support token-style custom deployments and zone domain.
    const zone = this.credentials.dnsZone;
    const list = await request(this.fetchFn, `https://dns.baidubce.com/v1/domain/${encodeURIComponent(zone)}/record?rr=${encodeURIComponent(relativeRecord(name, zone))}`, {
      headers: { ...headers, 'X-Bce-Access-Key': this.credentials.accessKeyId },
    });
    if (!list.ok) fail(`百度云查询失败（HTTP ${list.status}）。如需官方签名鉴权，请改用 Callback 对接。`);
    const records = list.json?.recordList || list.json?.records || [];
    const found = (Array.isArray(records) ? records : []).find((item) => item.type === type);
    if (found && sameIp(found.value, content)) return { changed: false };
    const body = { domain: zone, rdtype: type, rdata: content, rr: relativeRecord(name, zone), ttl: Number(ttl) || 60, ...(found ? { id: found.id } : {}) };
    const saved = await request(this.fetchFn, found ? `https://dns.baidubce.com/v1/domain/${encodeURIComponent(zone)}/record/${found.id}` : `https://dns.baidubce.com/v1/domain/${encodeURIComponent(zone)}/record`, {
      method: found ? 'PUT' : 'POST', headers: { ...headers, 'X-Bce-Access-Key': this.credentials.accessKeyId }, body,
    });
    if (!saved.ok) fail(`百度云更新失败（HTTP ${saved.status}）`);
    return { changed: true };
  }
}

export class AliyunEsaDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl }) {
    // ESA uses OpenAPI; without full RPC signer we expose a pragmatic HTTPS form that accepts pre-signed customParams URL, else fail with guidance.
    if (this.credentials.customUrl) {
      const url = replaceVars(this.credentials.customUrl, { ip: content, domain: name, recordType: type, ttl: String(ttl || 600) });
      const result = await request(this.fetchFn, url);
      if (!result.ok) fail(`阿里云 ESA 更新失败（HTTP ${result.status}）`);
      return { changed: true };
    }
    fail('阿里云 ESA 请在自定义参数中提供 customUrl，或使用 Callback；完整 OpenAPI 签名可后续增强', 400);
  }
}

export class EdgeOneDdnsClient extends HttpJsonClient {
  async upsert({ name, type, content, ttl, previous }) {
    if (this.credentials.url) {
      const client = new CallbackDdnsClient({ url: this.credentials.url, requestBody: this.credentials.requestBody || '', headers: this.credentials.headers || '' }, { fetchFn: this.fetchFn });
      return client.upsert({ name, type, content, ttl, previous });
    }
    fail('EdgeOne 请填写 Callback 风格 URL（credentials.url）或使用腾讯云 DNS 服务商', 400);
  }
}

void net;
