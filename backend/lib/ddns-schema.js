import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { DEFAULT_IPV4_URLS, DEFAULT_IPV6_URLS } from './ddns-ip.js';

const text = (value) => String(value ?? '').trim();
const flag = (value) => value === true || value === 'true' || value === 1;
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
const domain = (value) => text(value).toLowerCase().replace(/\.$/, '');
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const pick = (input, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));

export const DDNS_PROVIDERS = {
  cloudflare: 'Cloudflare',
  aliyun: '阿里云 DNS',
  aliyun_esa: '阿里云 ESA',
  tencentcloud: '腾讯云 DNS',
  dnspod: 'DNSPod',
  huaweicloud: '华为云',
  baiducloud: '百度云',
  porkbun: 'Porkbun',
  godaddy: 'GoDaddy',
  namecheap: 'Namecheap',
  namesilo: 'NameSilo',
  dynadot: 'Dynadot',
  dnsla: 'DNSLA',
  nowcn: '时代互联',
  eranet: 'Eranet',
  tnethk: 'Tnethk',
  gcore: 'Gcore',
  edgeone: 'EdgeOne',
  nsone: 'IBM NS1 Connect',
  rainyun: '雨云',
  desec: 'deSEC',
  callback: 'Callback',
};

export const IP_GET_TYPES = { url: '接口', netInterface: '网卡', command: '命令' };
const SECRET_FIELDS = new Set([
  'apiToken', 'accessKeySecret', 'secretKey', 'secret', 'password', 'token', 'apiKey', 'secretApiKey', 'authToken',
]);

const runtime = () => ({
  lastIpv4: null, lastIpv6: null, lastChanged: null,
  lastRunAt: null, lastSuccessAt: null, lastError: null, lastErrorCode: null, lastErrorDetail: null,
});

export function validDomain(value, wildcard = false) {
  const name = wildcard ? domain(value).replace(/^\*\./, '') : domain(value);
  return Boolean(name && !net.isIP(name) && name.length <= 253 && name.includes('.') && name.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)));
}

function defaultStack(type = 'A') {
  return {
    enabled: type === 'A',
    getType: 'url',
    urls: type === 'AAAA' ? [...DEFAULT_IPV6_URLS] : [...DEFAULT_IPV4_URLS],
    netInterface: '',
    command: '',
    domains: [],
  };
}

function defaultCredentials(provider = 'cloudflare') {
  if (provider === 'cloudflare') return { zoneId: '', apiToken: '', proxied: false };
  if (provider === 'aliyun' || provider === 'aliyun_esa') return { accessKeyId: '', accessKeySecret: '', dnsZone: '', line: 'default' };
  if (provider === 'tencentcloud' || provider === 'dnspod') return { secretId: '', secretKey: '', dnsZone: '', line: '默认', id: '', token: '' };
  if (provider === 'callback' || provider === 'edgeone') return { url: '', requestBody: '', headers: '' };
  if (provider === 'namecheap') return { password: '', dnsZone: '' };
  if (provider === 'desec') return { token: '', dnsZone: '' };
  if (provider === 'nsone') return { apiKey: '', dnsZone: '' };
  if (provider === 'gcore') return { apiKey: '', dnsZone: '' };
  if (provider === 'rainyun') return { apiKey: '', dnsZone: '' };
  if (provider === 'huaweicloud') return { id: '', secret: '', dnsZone: '' };
  if (provider === 'baiducloud') return { accessKeyId: '', accessKeySecret: '', dnsZone: '' };
  return { id: '', secret: '', dnsZone: '' };
}

export function defaultDdnsTask(partial = {}) {
  const provider = Object.hasOwn(DDNS_PROVIDERS, partial.provider) ? partial.provider : 'cloudflare';
  return {
    id: partial.id || randomUUID(),
    name: text(partial.name) || '默认任务',
    enabled: false,
    provider,
    credentials: { ...defaultCredentials(provider), ...(partial.credentials || {}) },
    ipv4: { ...defaultStack('A'), ...(partial.ipv4 || {}) },
    ipv6: { ...defaultStack('AAAA'), ...(partial.ipv6 || {}), enabled: partial.ipv6?.enabled === true },
    ttl: partial.ttl ?? (provider === 'cloudflare' ? 1 : 600),
    customParams: text(partial.customParams),
    ...runtime(),
    ...(partial.lastIpv4 !== undefined ? { lastIpv4: partial.lastIpv4 } : {}),
    ...(partial.lastIpv6 !== undefined ? { lastIpv6: partial.lastIpv6 } : {}),
    ...(partial.lastRunAt !== undefined ? pick(partial, ['lastRunAt', 'lastSuccessAt', 'lastError', 'lastErrorCode', 'lastErrorDetail', 'lastChanged']) : {}),
  };
}

function defaultPools() {
  return {
    cloudflare: defaultCredentials('cloudflare'),
    aliyun: defaultCredentials('aliyun'),
    dnspod: defaultCredentials('tencentcloud'),
  };
}

export function defaultDdns() {
  return {
    version: 2,
    intervalSeconds: 300,
    cacheTimes: 1,
    webhook: { enabled: false, url: '', requestBody: '', headers: '' },
    pools: defaultPools(),
    tasks: [],
    logs: [],
  };
}

function normalizeStack(saved = {}, type = 'A') {
  const defaults = defaultStack(type);
  const urls = Array.isArray(saved.urls)
    ? saved.urls.map((item) => text(item)).filter(Boolean)
    : text(saved.urls).split(/\n+/).map((item) => text(item)).filter(Boolean);
  const domains = Array.isArray(saved.domains)
    ? saved.domains.map(domain).filter(Boolean)
    : text(saved.domains).split(/[\n,，;；\s]+/).map(domain).filter(Boolean);
  const getType = Object.hasOwn(IP_GET_TYPES, saved.getType) ? saved.getType : 'url';
  return {
    enabled: flag(saved.enabled ?? defaults.enabled),
    getType,
    urls: urls.length ? urls : defaults.urls,
    netInterface: text(saved.netInterface),
    command: text(saved.command),
    domains,
  };
}

function normalizeTask(saved = {}) {
  const provider = Object.hasOwn(DDNS_PROVIDERS, saved.provider) ? saved.provider : 'cloudflare';
  const credentials = { ...defaultCredentials(provider), ...(saved.credentials && typeof saved.credentials === 'object' ? saved.credentials : {}) };
  for (const key of Object.keys(credentials)) {
    if (typeof credentials[key] === 'string') credentials[key] = text(credentials[key]);
    if (key === 'proxied') credentials[key] = flag(credentials[key]);
    if (key === 'dnsZone') credentials[key] = domain(credentials[key]);
  }
  return {
    ...defaultDdnsTask({ ...saved, provider, credentials }),
    id: text(saved.id) || randomUUID(),
    name: text(saved.name) || '未命名任务',
    enabled: flag(saved.enabled),
    provider,
    credentials,
    ipv4: normalizeStack(saved.ipv4, 'A'),
    ipv6: normalizeStack({ ...defaultStack('AAAA'), ...saved.ipv6, enabled: saved.ipv6?.enabled }, 'AAAA'),
    ttl: number(saved.ttl, provider === 'cloudflare' ? 1 : 600, 1, 86400),
    customParams: text(saved.customParams),
    lastIpv4: saved.lastIpv4 || null,
    lastIpv6: saved.lastIpv6 || null,
    lastChanged: saved.lastChanged ?? null,
    lastRunAt: saved.lastRunAt || null,
    lastSuccessAt: saved.lastSuccessAt || null,
    lastError: saved.lastError || null,
    lastErrorCode: saved.lastErrorCode || null,
    lastErrorDetail: saved.lastErrorDetail || null,
  };
}

/** Migrate flat v1 DDNS object into a single v2 task. */
export function migrateFlatDdns(flat = {}) {
  if (!flat || typeof flat !== 'object') return defaultDdns();
  if (flat.version === 2 && Array.isArray(flat.tasks)) return null;
  const provider = Object.hasOwn(DDNS_PROVIDERS, flat.provider) ? flat.provider : (flat.provider === 'dnspod' ? 'dnspod' : 'cloudflare');
  const mappedProvider = provider === 'dnspod' && flat.dnspod?.secretId ? 'tencentcloud' : provider;
  const credentials = defaultCredentials(mappedProvider);
  if (mappedProvider === 'cloudflare') {
    credentials.zoneId = text(flat.zoneId);
    credentials.apiToken = text(flat.apiToken);
    credentials.proxied = flag(flat.proxied);
  } else if (mappedProvider === 'aliyun') {
    Object.assign(credentials, {
      accessKeyId: text(flat.aliyun?.accessKeyId),
      accessKeySecret: text(flat.aliyun?.accessKeySecret),
      dnsZone: domain(flat.aliyun?.dnsZone),
      line: text(flat.aliyun?.line) || 'default',
    });
  } else if (mappedProvider === 'tencentcloud' || mappedProvider === 'dnspod') {
    Object.assign(credentials, {
      secretId: text(flat.dnspod?.secretId),
      secretKey: text(flat.dnspod?.secretKey),
      dnsZone: domain(flat.dnspod?.dnsZone),
      line: text(flat.dnspod?.line) || '默认',
      id: text(flat.dnspod?.id),
      token: text(flat.dnspod?.token),
    });
  }
  const recordName = domain(flat.recordName);
  const recordType = flat.recordType === 'AAAA' ? 'AAAA' : 'A';
  const ipv4 = defaultStack('A');
  const ipv6 = defaultStack('AAAA');
  ipv4.enabled = recordType === 'A';
  ipv6.enabled = recordType === 'AAAA';
  if (recordName) (recordType === 'AAAA' ? ipv6 : ipv4).domains = [recordName];
  const intervalMinutes = number(flat.intervalMinutes, 10, 5, 1440);
  const task = normalizeTask({
    id: randomUUID(),
    name: recordName || '迁移任务',
    enabled: flag(flat.enabled),
    provider: mappedProvider === 'dnspod' && credentials.secretId ? 'tencentcloud' : mappedProvider,
    credentials,
    ipv4,
    ipv6,
    ttl: number(flat.ttl, mappedProvider === 'cloudflare' ? 1 : 600, 1, 86400),
    lastIpv4: recordType === 'A' ? flat.lastIp || null : null,
    lastIpv6: recordType === 'AAAA' ? flat.lastIp || null : null,
    lastChanged: flat.lastChanged ?? null,
    lastRunAt: flat.lastRunAt || null,
    lastSuccessAt: flat.lastSuccessAt || null,
    lastError: flat.lastError || null,
    lastErrorCode: flat.lastErrorCode || null,
    lastErrorDetail: flat.lastErrorDetail || null,
  });
  const pools = defaultPools();
  if (mappedProvider === 'cloudflare' || credentials.apiToken || credentials.zoneId) {
    pools.cloudflare = {
      zoneId: text(flat.zoneId) || credentials.zoneId || '',
      apiToken: text(flat.apiToken) || credentials.apiToken || '',
      proxied: flag(flat.proxied ?? credentials.proxied),
    };
  }
  pools.aliyun = {
    accessKeyId: text(flat.aliyun?.accessKeyId) || pools.aliyun.accessKeyId,
    accessKeySecret: text(flat.aliyun?.accessKeySecret) || pools.aliyun.accessKeySecret,
    dnsZone: domain(flat.aliyun?.dnsZone) || pools.aliyun.dnsZone,
    line: text(flat.aliyun?.line) || 'default',
  };
  pools.dnspod = {
    secretId: text(flat.dnspod?.secretId) || pools.dnspod.secretId,
    secretKey: text(flat.dnspod?.secretKey) || pools.dnspod.secretKey,
    dnsZone: domain(flat.dnspod?.dnsZone) || pools.dnspod.dnsZone,
    line: text(flat.dnspod?.line) || '默认',
    id: text(flat.dnspod?.id),
    token: text(flat.dnspod?.token),
  };
  return {
    version: 2,
    intervalSeconds: intervalMinutes * 60,
    cacheTimes: 1,
    webhook: { enabled: false, url: '', requestBody: '', headers: '' },
    pools,
    tasks: [task],
    logs: [],
  };
}

export function normalizeDdns(saved = {}) {
  if (!saved || typeof saved !== 'object') return defaultDdns();
  if (saved.version !== 2 || !Array.isArray(saved.tasks)) {
    const migrated = migrateFlatDdns(saved);
    if (migrated) return migrated;
  }
  const defaults = defaultDdns();
  const pools = defaultPools();
  for (const key of ['cloudflare', 'aliyun', 'dnspod']) {
    pools[key] = { ...pools[key], ...(saved.pools?.[key] || {}) };
  }
  return {
    version: 2,
    intervalSeconds: number(saved.intervalSeconds, defaults.intervalSeconds, 10, 86400),
    cacheTimes: number(saved.cacheTimes, 1, 1, 3600),
    webhook: {
      enabled: flag(saved.webhook?.enabled),
      url: text(saved.webhook?.url),
      requestBody: text(saved.webhook?.requestBody),
      headers: text(saved.webhook?.headers),
    },
    pools,
    tasks: (Array.isArray(saved.tasks) ? saved.tasks : []).map(normalizeTask),
    logs: Array.isArray(saved.logs)
      ? saved.logs.slice(-50).map((item) => ({
        at: text(item?.at) || new Date().toISOString(),
        level: ['info', 'warn', 'error'].includes(item?.level) ? item.level : 'info',
        message: text(item?.message).slice(0, 2000),
      }))
      : [],
  };
}

function mergeSecret(next, existing, key, clearKey, patch) {
  const incoming = text(patch?.[key]);
  if (incoming) return incoming;
  if (flag(patch?.[clearKey]) || flag(patch?.[`clear${key[0].toUpperCase()}${key.slice(1)}`])) return '';
  return text(existing?.[key]);
}

function normalizeCredentials(provider, input = {}, existing = {}) {
  const scrubbedInput = Object.fromEntries(Object.entries(input || {}).filter(([key]) => !key.startsWith('has') && key !== 'clearApiToken' && !key.startsWith('clear')));
  const scrubbedExisting = Object.fromEntries(Object.entries(existing || {}).filter(([key]) => !key.startsWith('has') && !key.startsWith('clear')));
  const base = { ...defaultCredentials(provider), ...scrubbedExisting, ...scrubbedInput };
  const clear = (key, clearKey) => mergeSecret(base, scrubbedExisting, key, clearKey, input);
  if (provider === 'cloudflare') {
    const zoneId = text(input.zoneId ?? existing.zoneId);
    if (zoneId && !/^[a-z0-9_-]{16,80}$/i.test(zoneId)) fail('Cloudflare Zone ID 格式无效');
    return { zoneId, apiToken: clear('apiToken', 'clearApiToken'), proxied: flag(input.proxied ?? existing.proxied) };
  }
  if (provider === 'aliyun' || provider === 'aliyun_esa' || provider === 'baiducloud') {
    const accessKeyId = text(input.accessKeyId ?? existing.accessKeyId);
    const accessKeySecret = clear('accessKeySecret', 'clearAccessKeySecret');
    if (accessKeyId !== text(existing.accessKeyId) && text(existing.accessKeySecret) && !text(input.accessKeySecret) && !flag(input.clearAccessKeySecret)) {
      fail('更换云账号 ID 时请同时填写对应的新密钥');
    }
    return {
      accessKeyId,
      accessKeySecret,
      dnsZone: domain(input.dnsZone ?? existing.dnsZone),
      line: text(input.line ?? existing.line) || 'default',
    };
  }
  if (provider === 'huaweicloud') {
    // Accept UI aliases accessKeyId/accessKeySecret as id/secret (project id + token).
    const id = text(input.id ?? input.accessKeyId ?? existing.id ?? existing.accessKeyId);
    const secret = text(input.secret) || text(input.accessKeySecret)
      || (flag(input.clearSecret) || flag(input.clearAccessKeySecret) ? '' : text(existing.secret || existing.accessKeySecret));
    if (id !== text(existing.id || existing.accessKeyId) && text(existing.secret || existing.accessKeySecret) && !text(input.secret) && !text(input.accessKeySecret) && !flag(input.clearSecret) && !flag(input.clearAccessKeySecret)) {
      fail('更换云账号 ID 时请同时填写对应的新密钥');
    }
    return { id, secret, dnsZone: domain(input.dnsZone ?? existing.dnsZone) };
  }
  if (provider === 'tencentcloud' || provider === 'dnspod') {
    const secretId = text(input.secretId ?? existing.secretId);
    const secretKey = clear('secretKey', 'clearSecretKey');
    if (secretId !== text(existing.secretId) && text(existing.secretKey) && !text(input.secretKey) && !flag(input.clearSecretKey)) {
      fail('更换云账号 ID 时请同时填写对应的新密钥');
    }
    return {
      secretId,
      secretKey,
      id: text(input.id ?? existing.id),
      token: clear('token', 'clearToken'),
      dnsZone: domain(input.dnsZone ?? existing.dnsZone),
      line: text(input.line ?? existing.line) || '默认',
    };
  }
  if (provider === 'callback' || provider === 'edgeone') {
    return {
      url: text(input.url ?? existing.url),
      requestBody: text(input.requestBody ?? existing.requestBody),
      headers: text(input.headers ?? existing.headers),
    };
  }
  if (provider === 'namecheap') {
    return { password: clear('password', 'clearPassword'), dnsZone: domain(input.dnsZone ?? existing.dnsZone) };
  }
  if (provider === 'desec' || provider === 'nsone' || provider === 'gcore' || provider === 'rainyun') {
    const key = provider === 'desec' ? 'token' : 'apiKey';
    return { [key]: clear(key, `clear${key[0].toUpperCase()}${key.slice(1)}`), dnsZone: domain(input.dnsZone ?? existing.dnsZone) };
  }
  const id = text(input.id ?? existing.id);
  const secret = clear('secret', 'clearSecret');
  if (id !== text(existing.id) && text(existing.secret) && !text(input.secret) && !flag(input.clearSecret)) {
    fail('更换账号 ID 时请同时填写对应的新密钥');
  }
  return { id, secret, dnsZone: domain(input.dnsZone ?? existing.dnsZone), ...(provider === 'porkbun' ? { secretApiKey: clear('secretApiKey', 'clearSecretApiKey') || secret } : {}) };
}

function validateStack(stack, label) {
  if (!stack.enabled) return;
  if (!Object.hasOwn(IP_GET_TYPES, stack.getType)) fail(`${label} 取 IP 方式无效`);
  if (stack.getType === 'url' && !stack.urls.length) fail(`${label} 请至少填写一个 IP 接口`);
  if (stack.getType === 'netInterface' && !stack.netInterface) fail(`${label} 请填写网卡名称或匹配规则`);
  if (stack.getType === 'command' && !stack.command) fail(`${label} 请填写取 IP 命令`);
  if (!stack.domains.length) fail(`${label} 请至少填写一个域名`);
  if (stack.domains.some((name) => !validDomain(name))) fail(`${label} 域名格式无效`);
}

export function assertDdnsTaskReady(task) {
  if (!Object.hasOwn(DDNS_PROVIDERS, task.provider)) fail('不支持的 DDNS 服务商');
  if (!task.ipv4.enabled && !task.ipv6.enabled) fail('请至少启用 IPv4 或 IPv6');
  validateStack(task.ipv4, 'IPv4');
  validateStack(task.ipv6, 'IPv6');
  const c = task.credentials;
  if (task.provider === 'cloudflare') {
    if (!c.zoneId || !c.apiToken) fail('请先保存 Cloudflare Zone ID 和 API Token');
  } else   if (task.provider === 'callback' || task.provider === 'edgeone') {
    if (!c.url) fail(`请先保存${DDNS_PROVIDERS[task.provider]} URL`);
  } else if (task.provider === 'huaweicloud') {
    if (!c.id || !c.secret || !c.dnsZone) fail('请先保存华为云项目 ID、Token 与 Zone ID');
  } else if (task.provider === 'aliyun' || task.provider === 'aliyun_esa' || task.provider === 'baiducloud') {
    if (!c.accessKeyId || !c.accessKeySecret) fail(`请先保存${DDNS_PROVIDERS[task.provider]}凭据`);
    if ((task.provider === 'aliyun' || task.provider === 'aliyun_esa') && !c.dnsZone) fail('请先保存 DNS 主域名');
  } else if (task.provider === 'tencentcloud') {
    if (!c.secretId || !c.secretKey || !c.dnsZone) fail(`请先保存${DDNS_PROVIDERS[task.provider]}凭据与主域名`);
  } else if (task.provider === 'dnspod') {
    if ((!c.id || !c.token) && (!c.secretId || !c.secretKey) || !c.dnsZone) fail('请先保存 DNSPod 凭据与主域名');
  } else if (task.provider === 'namecheap') {
    if (!c.password || !c.dnsZone) fail('请先保存 Namecheap 密码与主域名');
  } else if (['desec', 'nsone', 'gcore', 'rainyun'].includes(task.provider)) {
    const key = task.provider === 'desec' ? 'token' : 'apiKey';
    if (!c[key]) fail(`请先保存${DDNS_PROVIDERS[task.provider]}凭据`);
  } else if (!c.id || !c.secret) {
    fail(`请先保存${DDNS_PROVIDERS[task.provider]}凭据`);
  }
}

function poolKeyFor(provider) {
  if (provider === 'tencentcloud') return 'dnspod';
  if (['cloudflare', 'aliyun', 'dnspod'].includes(provider)) return provider;
  return null;
}

function updateTask(existing, input = {}, pools = {}) {
  const provider = Object.hasOwn(input, 'provider')
    ? (Object.hasOwn(DDNS_PROVIDERS, input.provider) ? input.provider : fail('不支持的 DDNS 服务商'))
    : existing.provider;
  const next = {
    ...existing,
    ...pick(input, ['name', 'enabled', 'ttl', 'customParams']),
    provider,
    id: text(input.id) || existing.id || randomUUID(),
  };
  next.name = text(next.name) || '未命名任务';
  next.enabled = flag(next.enabled);
  if (provider !== existing.provider && !Object.hasOwn(input, 'enabled')) next.enabled = false;
  next.ttl = number(next.ttl, provider === 'cloudflare' ? 1 : 600, 1, 86400);
  if (provider !== existing.provider && provider !== 'cloudflare' && next.ttl === 1 && !Object.hasOwn(input, 'ttl')) next.ttl = 600;
  if (provider !== 'cloudflare' && next.ttl < 60) fail('该服务商 TTL 至少 60 秒');
  if (provider === 'cloudflare' && next.ttl !== 1 && next.ttl < 60) fail('Cloudflare TTL 请使用自动（1）或至少 60 秒');
  next.customParams = text(next.customParams);
  const poolKey = poolKeyFor(provider);
  const credentialBase = provider !== existing.provider
    ? { ...(poolKey && pools?.[poolKey] ? pools[poolKey] : defaultCredentials(provider)) }
    : existing.credentials;
  next.credentials = normalizeCredentials(provider, input.credentials || {}, credentialBase);
  next.ipv4 = normalizeStack(input.ipv4 ? { ...existing.ipv4, ...input.ipv4 } : existing.ipv4, 'A');
  next.ipv6 = normalizeStack(input.ipv6 ? { ...existing.ipv6, ...input.ipv6 } : existing.ipv6, 'AAAA');
  if (next.enabled) assertDdnsTaskReady(next);
  const fingerprint = (task) => JSON.stringify([task.provider, task.ttl, task.credentials, task.ipv4, task.ipv6, task.customParams]);
  if (fingerprint(next) !== fingerprint(existing)) Object.assign(next, runtime());
  return next;
}

/** Accept full v2 document, or legacy flat fields that patch/create tasks[0]. */
export function updateDdnsConfig(existing, input = {}) {
  existing = normalizeDdns(existing);
  const isLegacy = !Object.hasOwn(input, 'tasks') && !Object.hasOwn(input, 'webhook') && !Object.hasOwn(input, 'intervalSeconds')
    && (Object.hasOwn(input, 'provider') || Object.hasOwn(input, 'recordName') || Object.hasOwn(input, 'zoneId') || Object.hasOwn(input, 'aliyun') || Object.hasOwn(input, 'dnspod') || Object.hasOwn(input, 'apiToken') || Object.hasOwn(input, 'intervalMinutes') || Object.hasOwn(input, 'recordType') || Object.hasOwn(input, 'enabled') || Object.hasOwn(input, 'ttl') || Object.hasOwn(input, 'proxied'));

  if (isLegacy) {
    const view = legacyView(existing);
    if (Object.hasOwn(input, 'provider') && !Object.hasOwn(DDNS_PROVIDERS, input.provider) && input.provider !== 'dnspod') fail('不支持的 DDNS 服务商');
    if (Object.hasOwn(input, 'recordType') && !['A', 'AAAA'].includes(input.recordType)) fail('DDNS 仅支持 A 或 AAAA 记录');
    const flat = {
      provider: input.provider ?? view.provider,
      enabled: Object.hasOwn(input, 'enabled') ? input.enabled : view.enabled,
      recordName: Object.hasOwn(input, 'recordName') ? input.recordName : view.recordName,
      recordType: Object.hasOwn(input, 'recordType') ? input.recordType : view.recordType,
      ttl: Object.hasOwn(input, 'ttl') ? input.ttl : view.ttl,
      proxied: Object.hasOwn(input, 'proxied') ? input.proxied : view.proxied,
      intervalMinutes: Object.hasOwn(input, 'intervalMinutes') ? input.intervalMinutes : view.intervalMinutes,
      zoneId: Object.hasOwn(input, 'zoneId') ? input.zoneId : view.zoneId,
      apiToken: Object.hasOwn(input, 'apiToken') ? input.apiToken : '',
      clearApiToken: input.clearApiToken,
      aliyun: {
        ...view.aliyun,
        ...(input.aliyun || {}),
        accessKeySecret: text(input.aliyun?.accessKeySecret) || view.aliyun.accessKeySecret,
      },
      dnspod: {
        ...view.dnspod,
        ...(input.dnspod || {}),
        secretKey: text(input.dnspod?.secretKey) || view.dnspod.secretKey,
        token: text(input.dnspod?.token) || view.dnspod.token,
      },
      lastIp: view.lastIp,
      lastChanged: view.lastChanged,
      lastRunAt: view.lastRunAt,
      lastSuccessAt: view.lastSuccessAt,
      lastError: view.lastError,
    };
    if (flat.recordName && !validDomain(flat.recordName)) fail('DDNS 记录名称格式无效');
    const legacyProvider = flat.provider === 'dnspod' ? 'dnspod' : flat.provider;
    if (legacyProvider === 'aliyun' || legacyProvider === 'dnspod' || legacyProvider === 'tencentcloud') {
      const zone = legacyProvider === 'aliyun' ? domain(flat.aliyun.dnsZone) : domain(flat.dnspod.dnsZone);
      const line = legacyProvider === 'aliyun' ? text(flat.aliyun.line) : text(flat.dnspod.line);
      if (line.length > 128 || /[\r\n\x00-\x1f]/.test(line)) fail('解析线路格式无效');
      if (Object.hasOwn(input, 'ttl') && number(input.ttl, 600, 1, 86400) < 60) fail('阿里云 / 腾讯云 TTL 至少 60 秒，建议使用 600 秒');
      if (zone && flat.recordName && flat.recordName !== zone && !flat.recordName.endsWith(`.${zone}`)) fail('完整记录名称必须属于所填 DNS 主域名');
    }
    // Force v1-shaped object so migrateFlatDdns always rebuilds a task snapshot.
    delete flat.version;
    delete flat.tasks;
    const snapshot = migrateFlatDdns(flat) || defaultDdns();
    const primaryIndex = Math.max(0, existing.tasks.findIndex((task) => task.enabled));
    const previous = existing.tasks[primaryIndex] || existing.tasks[0];
    let updatedTask = snapshot.tasks[0] || defaultDdnsTask();
    if (previous) {
      let provider = snapshot.tasks[0]?.provider || previous.provider;
      if (flat.provider === 'dnspod' && flat.dnspod?.secretId) provider = 'tencentcloud';
      if (flat.provider === 'dnspod' && !flat.dnspod?.secretId) provider = 'dnspod';
      if (flat.provider === 'aliyun') provider = 'aliyun';
      if (flat.provider === 'cloudflare') provider = 'cloudflare';
      const patch = {
        provider,
        name: previous.name,
        enabled: Object.hasOwn(input, 'enabled')
          ? flag(input.enabled)
          : (Object.hasOwn(input, 'provider') && input.provider !== view.provider ? false : previous.enabled),
        credentials: provider === 'cloudflare'
          ? {
            zoneId: flat.zoneId,
            proxied: flat.proxied,
            ...(text(input.apiToken) ? { apiToken: input.apiToken } : {}),
            ...(input.clearApiToken ? { clearApiToken: true } : {}),
          }
          : provider === 'aliyun'
            ? {
              accessKeyId: flat.aliyun.accessKeyId,
              dnsZone: flat.aliyun.dnsZone,
              line: flat.aliyun.line,
              ...(text(input.aliyun?.accessKeySecret) ? { accessKeySecret: input.aliyun.accessKeySecret } : {}),
              ...(input.aliyun?.clearAccessKeySecret ? { clearAccessKeySecret: true } : {}),
            }
            : {
              secretId: flat.dnspod.secretId,
              dnsZone: flat.dnspod.dnsZone,
              line: flat.dnspod.line,
              id: flat.dnspod.id,
              ...(text(input.dnspod?.secretKey) ? { secretKey: input.dnspod.secretKey } : {}),
              ...(text(input.dnspod?.token) ? { token: input.dnspod.token } : {}),
              ...(input.dnspod?.clearSecretKey ? { clearSecretKey: true } : {}),
              ...(input.dnspod?.clearToken ? { clearToken: true } : {}),
            },
        ipv4: snapshot.tasks[0].ipv4,
        ipv6: snapshot.tasks[0].ipv6,
      };
      if (Object.hasOwn(input, 'ttl')) patch.ttl = number(input.ttl, previous.ttl, 1, 86400);
      const poolKey = provider === 'tencentcloud' ? 'dnspod' : (provider === 'cloudflare' ? 'cloudflare' : provider);
      const pooled = existing.pools?.[poolKey] || {};
      if (provider !== previous.provider) {
        patch.credentials = { ...pooled, ...patch.credentials };
        if (!Object.hasOwn(input, 'ttl') && provider !== 'cloudflare' && Number(previous.ttl) === 1) patch.ttl = 600;
        updatedTask = updateTask({ ...previous, credentials: { ...pooled } }, patch, existing.pools);
      } else {
        // Interval-only / credential-only legacy patches must not rebuild domains from empty flat fields.
        if (!Object.hasOwn(input, 'recordName') && !Object.hasOwn(input, 'recordType')) {
          patch.ipv4 = previous.ipv4;
          patch.ipv6 = previous.ipv6;
        }
        updatedTask = updateTask(previous, patch, existing.pools);
      }
    }
    const tasks = existing.tasks.length
      ? existing.tasks.map((task, index) => (index === (previous ? primaryIndex : 0) ? updatedTask : task))
      : [updatedTask];
    const next = {
      ...existing,
      intervalSeconds: Object.hasOwn(input, 'intervalMinutes')
        ? number(input.intervalMinutes, 10, 5, 1440) * 60
        : existing.intervalSeconds,
      tasks,
      pools: { ...defaultPools(), ...existing.pools },
    };
    const active = updatedTask;
    if (active) {
      if (active.provider === 'cloudflare') next.pools.cloudflare = { ...next.pools.cloudflare, ...active.credentials };
      if (active.provider === 'aliyun') next.pools.aliyun = { ...next.pools.aliyun, ...active.credentials };
      if (active.provider === 'tencentcloud' || active.provider === 'dnspod') next.pools.dnspod = { ...next.pools.dnspod, ...active.credentials };
    }
    if (Object.hasOwn(input, 'zoneId') || Object.hasOwn(input, 'apiToken') || Object.hasOwn(input, 'clearApiToken') || Object.hasOwn(input, 'proxied')) {
      next.pools.cloudflare = normalizeCredentials('cloudflare', {
        zoneId: flat.zoneId, apiToken: input.apiToken, clearApiToken: input.clearApiToken, proxied: flat.proxied,
      }, next.pools.cloudflare);
    }
    if (input.aliyun) {
      next.pools.aliyun = normalizeCredentials('aliyun', {
        ...flat.aliyun,
        accessKeySecret: input.aliyun.accessKeySecret,
        clearAccessKeySecret: input.aliyun.clearAccessKeySecret,
      }, next.pools.aliyun);
    }
    if (input.dnspod) {
      next.pools.dnspod = normalizeCredentials('tencentcloud', {
        ...flat.dnspod,
        secretKey: input.dnspod.secretKey,
        clearSecretKey: input.dnspod.clearSecretKey,
      }, next.pools.dnspod);
    }
    if (updatedTask?.enabled) assertDdnsTaskReady(updatedTask);
    return normalizeDdns(next);
  }

  const next = {
    version: 2,
    intervalSeconds: Object.hasOwn(input, 'intervalSeconds') ? number(input.intervalSeconds, 300, 10, 86400) : existing.intervalSeconds,
    cacheTimes: Object.hasOwn(input, 'cacheTimes') ? number(input.cacheTimes, 1, 1, 3600) : existing.cacheTimes,
    webhook: existing.webhook,
    pools: existing.pools || defaultPools(),
    tasks: existing.tasks,
    logs: existing.logs,
  };
  if (Object.hasOwn(input, 'webhook') && input.webhook && typeof input.webhook === 'object') {
    next.webhook = {
      enabled: flag(input.webhook.enabled),
      url: text(input.webhook.url),
      requestBody: text(input.webhook.requestBody ?? existing.webhook.requestBody),
      headers: text(input.webhook.headers ?? existing.webhook.headers),
    };
    if (next.webhook.enabled && !next.webhook.url) fail('启用 Webhook 前请填写 URL');
  }
  if (Object.hasOwn(input, 'tasks')) {
    if (!Array.isArray(input.tasks)) fail('tasks 必须是数组');
    if (input.tasks.length > 50) fail('最多 50 个 DDNS 任务');
    const byId = new Map(existing.tasks.map((task) => [task.id, task]));
    next.tasks = input.tasks.map((item) => {
      const prev = byId.get(text(item?.id)) || defaultDdnsTask({ provider: item?.provider });
      return updateTask(prev, item || {}, existing.pools);
    });
    // Refresh classic credential pools from active tasks so provider switches can restore them.
    next.pools = { ...defaultPools(), ...existing.pools };
    for (const task of next.tasks) {
      const key = poolKeyFor(task.provider);
      if (key) next.pools[key] = { ...next.pools[key], ...task.credentials };
    }
  }
  if (Object.hasOwn(input, 'logs') && Array.isArray(input.logs)) {
    next.logs = input.logs.slice(-50).map((item) => ({
      at: text(item?.at) || new Date().toISOString(),
      level: ['info', 'warn', 'error'].includes(item?.level) ? item.level : 'info',
      message: text(item?.message).slice(0, 2000),
    }));
  }
  return normalizeDdns(next);
}

/** Prefer the first enabled task for flat/legacy mirrors; otherwise tasks[0]. */
export function primaryDdnsTask(config) {
  const normalized = normalizeDdns(config);
  return normalized.tasks.find((task) => task.enabled) || normalized.tasks[0] || defaultDdnsTask();
}

/** Flatten primary task for legacy callers (zone discovery / older tests). */
export function legacyView(config) {
  const normalized = normalizeDdns(config);
  const task = primaryDdnsTask(normalized);
  const domains = [...(task.ipv4.enabled ? task.ipv4.domains : []), ...(task.ipv6.enabled ? task.ipv6.domains : [])];
  const recordType = task.ipv6.enabled && !task.ipv4.enabled ? 'AAAA' : 'A';
  const c = task.credentials;
  const pools = { ...defaultPools(), ...normalized.pools };
  const cloudflare = task.provider === 'cloudflare' ? { ...pools.cloudflare, ...c } : pools.cloudflare;
  const aliyun = task.provider === 'aliyun' ? { ...pools.aliyun, ...c } : pools.aliyun;
  const dnspod = ['tencentcloud', 'dnspod'].includes(task.provider) ? { ...pools.dnspod, ...c } : pools.dnspod;
  return {
    ...normalized,
    legacyTaskId: task.id,
    taskCount: normalized.tasks.length,
    enabledCount: normalized.tasks.filter((item) => item.enabled).length,
    provider: task.provider === 'tencentcloud' ? 'dnspod' : task.provider,
    enabled: task.enabled,
    recordName: domains[0] || '',
    recordType,
    ttl: task.ttl,
    proxied: Boolean(cloudflare.proxied),
    intervalMinutes: Math.max(5, Math.round(normalized.intervalSeconds / 60)),
    zoneId: cloudflare.zoneId || '',
    apiToken: cloudflare.apiToken || '',
    aliyun: {
      accessKeyId: aliyun.accessKeyId || '',
      accessKeySecret: aliyun.accessKeySecret || '',
      dnsZone: aliyun.dnsZone || '',
      line: aliyun.line || 'default',
    },
    dnspod: {
      secretId: dnspod.secretId || '',
      secretKey: dnspod.secretKey || '',
      dnsZone: dnspod.dnsZone || '',
      line: dnspod.line || '默认',
      id: dnspod.id || '',
      token: dnspod.token || '',
    },
    lastIp: recordType === 'AAAA' ? task.lastIpv6 : task.lastIpv4,
    lastChanged: task.lastChanged,
    lastRunAt: task.lastRunAt,
    lastSuccessAt: task.lastSuccessAt,
    lastError: task.lastError,
    lastErrorCode: task.lastErrorCode,
    lastErrorDetail: task.lastErrorDetail,
  };
}

function publicCredentials(credentials = {}) {
  const out = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (SECRET_FIELDS.has(key)) {
      out[`has${key[0].toUpperCase()}${key.slice(1)}`] = Boolean(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function publicDdns(config) {
  const normalized = normalizeDdns(config);
  const legacy = legacyView(normalized);
  return {
    version: 2,
    intervalSeconds: normalized.intervalSeconds,
    cacheTimes: normalized.cacheTimes,
    webhook: { ...normalized.webhook },
    tasks: normalized.tasks.map((task) => ({
      ...task,
      credentials: publicCredentials(task.credentials),
    })),
    logs: normalized.logs,
    taskCount: legacy.taskCount,
    enabledCount: legacy.enabledCount,
    legacyTaskId: legacy.legacyTaskId,
    // Legacy mirrors reflect the primary (first enabled) task only; prefer tasks[] for multi-task.
    provider: legacy.provider,
    enabled: legacy.enabled,
    recordName: legacy.recordName,
    recordType: legacy.recordType,
    ttl: legacy.ttl,
    proxied: legacy.proxied,
    intervalMinutes: legacy.intervalMinutes,
    zoneId: legacy.zoneId,
    hasApiToken: Boolean(legacy.apiToken),
    aliyun: {
      accessKeyId: legacy.aliyun.accessKeyId,
      dnsZone: legacy.aliyun.dnsZone,
      line: legacy.aliyun.line,
      hasAccessKeySecret: Boolean(legacy.aliyun.accessKeySecret),
    },
    dnspod: {
      secretId: legacy.dnspod.secretId,
      dnsZone: legacy.dnspod.dnsZone,
      line: legacy.dnspod.line,
      hasSecretKey: Boolean(legacy.dnspod.secretKey),
    },
    lastIp: legacy.lastIp,
    lastChanged: legacy.lastChanged,
    lastRunAt: legacy.lastRunAt,
    lastSuccessAt: legacy.lastSuccessAt,
    lastError: legacy.lastError,
    lastErrorCode: legacy.lastErrorCode,
    lastErrorDetail: legacy.lastErrorDetail,
  };
}

export function appendDdnsLog(config, entry) {
  const next = normalizeDdns(config);
  next.logs = [...next.logs, {
    at: entry.at || new Date().toISOString(),
    level: entry.level || 'info',
    message: text(entry.message).slice(0, 2000),
  }].slice(-50);
  return next;
}

export function assertDdnsReady(config) {
  const normalized = normalizeDdns(config);
  if (normalized.version === 2 && normalized.tasks?.length) {
    const task = normalized.tasks.find((item) => item.enabled) || normalized.tasks[0];
    assertDdnsTaskReady(task);
    return;
  }
  const legacy = legacyView(normalized);
  if (!legacy.recordName) fail('请先保存有效的 DDNS 完整记录名称与记录类型');
  assertDdnsTaskReady(normalizeTask({
    provider: legacy.provider === 'dnspod' ? 'tencentcloud' : legacy.provider,
    enabled: true,
    credentials: legacy.provider === 'cloudflare'
      ? { zoneId: legacy.zoneId, apiToken: legacy.apiToken, proxied: legacy.proxied }
      : legacy.provider === 'aliyun' ? legacy.aliyun : legacy.dnspod,
    ipv4: { enabled: legacy.recordType === 'A', domains: legacy.recordType === 'A' ? [legacy.recordName] : [] },
    ipv6: { enabled: legacy.recordType === 'AAAA', domains: legacy.recordType === 'AAAA' ? [legacy.recordName] : [] },
    ttl: legacy.ttl,
  }));
}
