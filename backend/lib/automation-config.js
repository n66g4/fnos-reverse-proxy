export {
  DDNS_PROVIDERS, IP_GET_TYPES, defaultDdns, defaultDdnsTask, normalizeDdns, updateDdnsConfig, publicDdns,
  assertDdnsReady, assertDdnsTaskReady, migrateFlatDdns, legacyView, primaryDdnsTask, appendDdnsLog, validDomain,
} from './ddns-schema.js';
import { normalizeDdns, validDomain } from './ddns-schema.js';

const text = (value) => String(value ?? '').trim();
const normalizeFreednsUsername = (value) => text(value).replace(/[\u200B-\u200D\uFEFF]/g, '');
const flag = (value) => value === true || value === 'true' || value === 1;
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
const pick = (input, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));
const domain = (value) => text(value).toLowerCase().replace(/\.$/, '');
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const runtime = () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, lastErrorCode: null, lastErrorDetail: null });
export const FREE_PRODUCT_CODE = 'digicert-free-1-free';
export const ACME_DNS_PROVIDERS = { cloudflare: 'Cloudflare', freedns: 'FreeDNS' };
export const defaultIssuance = () => ({
  provider: 'aliyun-free',
  acme: {
    dnsProvider: 'cloudflare', zoneId: '', apiToken: '', freednsUsername: '', freednsPassword: '', freednsSessionCookie: '',
    eabKid: '', eabHmacKey: '', email: '', domains: [], environment: 'staging', autoRenew: false, renewDays: 30, accountKeyPem: '', certificateId: null, phase: 'idle', ...runtime(),
  },
  aliyun: { apiVersion: 'v2', contactId: '', accessKeyId: '', accessKeySecret: '', domain: '', dnsZone: '', username: '', phone: '', email: '', autoRenew: false, renewDays: 15, certificateId: null, order: null, quota: null, phase: 'idle', ...runtime() },
});

export function migrateDomainAutomation(integrations) {
  const legacy = integrations.domainAutomation;
  if (!legacy) return false;
  // Copy once: later changes to either feature must never alter the other one.
  integrations.ddns ||= normalizeDdns({ ...legacy.ddns, zoneId: legacy.zoneId || '', apiToken: legacy.apiToken || '' });
  integrations.certificateIssuance ||= { ...defaultIssuance(), provider: 'acme', acme: { ...defaultIssuance().acme, ...legacy.acme, zoneId: legacy.zoneId || '', apiToken: legacy.apiToken || '' } };
  delete integrations.domainAutomation;
  return true;
}

function cloudflare(input, existing) {
  const zoneId = text(input.zoneId ?? existing.zoneId);
  const apiToken = text(input.apiToken) || (flag(input.clearApiToken) ? '' : existing.apiToken);
  if (zoneId && !/^[a-z0-9_-]{16,80}$/i.test(zoneId)) fail('Cloudflare Zone ID 格式无效');
  return { zoneId, apiToken };
}

function freedns(input, existing) {
  const freednsUsername = normalizeFreednsUsername(input.freednsUsername ?? existing.freednsUsername);
  const freednsPassword = text(input.freednsPassword) || (flag(input.clearFreednsPassword) ? '' : existing.freednsPassword);
  let freednsSessionCookie = text(input.freednsSessionCookie) || (flag(input.clearFreednsSessionCookie) ? '' : existing.freednsSessionCookie);
  if (freednsUsername !== existing.freednsUsername || freednsPassword !== existing.freednsPassword) freednsSessionCookie = '';
  return { freednsUsername, freednsPassword, freednsSessionCookie };
}

export function acmeDnsReady(acme) {
  if (acme.dnsProvider === 'freedns') return Boolean(acme.freednsUsername && (acme.freednsPassword || acme.freednsSessionCookie));
  return Boolean(acme.zoneId && acme.apiToken);
}

export function updateIssuanceConfig(existing, input = {}) {
  if (input.provider && !['acme', 'aliyun-free', 'zerossl'].includes(input.provider)) fail('不支持的证书签发服务');
  const a = input.acme || {};
  const y = input.aliyun || {};
  const provider = input.provider || existing.provider;
  const acme = {
    ...existing.acme,
    ...pick(a, ['email', 'domains', 'environment', 'autoRenew', 'renewDays', 'dnsProvider', 'eabKid']),
    ...cloudflare(a, existing.acme),
    ...freedns(a, existing.acme),
  };
  acme.dnsProvider = Object.hasOwn(ACME_DNS_PROVIDERS, a.dnsProvider ?? acme.dnsProvider) ? (a.dnsProvider ?? acme.dnsProvider) : 'cloudflare';
  acme.eabHmacKey = text(a.eabHmacKey) || (flag(a.clearEabHmacKey) ? '' : existing.acme.eabHmacKey);
  acme.eabKid = text(acme.eabKid);
  acme.email = text(acme.email).toLowerCase();
  acme.domains = [...new Set((Array.isArray(acme.domains) ? acme.domains : text(acme.domains).split(/[,，;；\s]+/)).map(domain).filter(Boolean))];
  acme.environment = acme.environment === 'production' ? 'production' : 'staging';
  acme.autoRenew = flag(acme.autoRenew);
  acme.renewDays = number(acme.renewDays, 30, 7, 60);
  if (acme.domains.length > 100 || acme.domains.some((name) => !validDomain(name, true))) fail('ACME 域名格式无效');
  if (acme.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acme.email)) fail('ACME 联系邮箱格式无效');
  if (acme.autoRenew && (!acmeDnsReady(acme) || !acme.email || !acme.domains.length)) fail('启用 ACME 自动轮换前请填写 DNS 凭据、邮箱和域名');
  if (acme.autoRenew && provider === 'zerossl' && (!acme.eabKid || !acme.eabHmacKey)) fail('启用 ZeroSSL 自动轮换前请填写 EAB 凭据');
  const caChanged = provider !== existing.provider;
  if (caChanged || acme.environment !== existing.acme.environment || acme.domains.join(',') !== existing.acme.domains.join(',')) {
    acme.certificateId = null; acme.lastRunAt = null; acme.lastSuccessAt = null; acme.phase = 'idle'; acme.lastError = null;
    if (caChanged) acme.accountKeyPem = '';
  }
  const aliyun = { ...existing.aliyun, ...pick(y, ['apiVersion', 'contactId', 'accessKeyId', 'domain', 'dnsZone', 'username', 'phone', 'email', 'autoRenew', 'renewDays']) };
  for (const key of ['accessKeyId', 'username', 'phone', 'email']) aliyun[key] = text(aliyun[key]);
  aliyun.accessKeySecret = text(y.accessKeySecret) || (y.clearAccessKeySecret ? '' : existing.aliyun.accessKeySecret);
  if (aliyun.accessKeyId !== existing.aliyun.accessKeyId && existing.aliyun.accessKeySecret && !text(y.accessKeySecret) && !y.clearAccessKeySecret) fail('更换 AccessKey ID 时请同时填写对应的新 Secret');
  if (aliyun.accessKeyId !== existing.aliyun.accessKeyId || aliyun.accessKeySecret !== existing.aliyun.accessKeySecret) {
    aliyun.quota = null;
    aliyun.lastError = null;
  }
  if (!['v1', 'v2'].includes(aliyun.apiVersion)) fail('请选择新版实例或旧版资源包');
  aliyun.contactId = text(aliyun.contactId);
  if (aliyun.contactId && (!/^\d+$/.test(aliyun.contactId) || !Number.isSafeInteger(Number(aliyun.contactId)) || Number(aliyun.contactId) < 1)) fail('联系人 ID 应为正整数');
  if (aliyun.apiVersion !== existing.aliyun.apiVersion) { aliyun.quota = null; aliyun.lastError = null; if (!Object.hasOwn(y, 'autoRenew')) aliyun.autoRenew = false; }
  aliyun.domain = domain(aliyun.domain); aliyun.dnsZone = domain(aliyun.dnsZone);
  aliyun.autoRenew = flag(aliyun.autoRenew);
  aliyun.renewDays = number(aliyun.renewDays, 15, 7, 30);
  if (aliyun.domain && !validDomain(aliyun.domain)) fail('阿里云免费证书仅支持单个普通域名，不支持通配符');
  if (aliyun.dnsZone && !validDomain(aliyun.dnsZone)) fail('阿里云 DNS 主域名格式无效');
  if (aliyun.domain && aliyun.dnsZone && aliyun.domain !== aliyun.dnsZone && !aliyun.domain.endsWith(`.${aliyun.dnsZone}`)) fail('证书域名必须属于所填 DNS 主域名');
  if (aliyun.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(aliyun.email)) fail('阿里云联系邮箱格式无效');
  if (aliyun.autoRenew && (!aliyun.accessKeyId || !aliyun.accessKeySecret || !aliyun.domain || !aliyun.dnsZone)) fail('启用阿里云自动轮换前请填写 AccessKey、证书域名和 DNS 主域名');
  const pending = existing.aliyun.order;
  if (pending && ['apiVersion', 'domain', 'dnsZone', 'accessKeyId'].some((key) => aliyun[key] !== existing.aliyun[key])) fail('当前订单尚未结束，请先完成或处理该订单，再更改域名与账号');
  if (aliyun.domain !== existing.aliyun.domain) {
    aliyun.certificateId = null; aliyun.lastRunAt = null; aliyun.lastSuccessAt = null; aliyun.phase = 'idle'; aliyun.lastError = null;
  }
  return { provider, acme, aliyun };
}

export function publicIssuance(config) {
  const { apiToken, accountKeyPem, freednsPassword, freednsSessionCookie, eabHmacKey, ...acme } = config.acme;
  const { accessKeySecret, order, ...aliyun } = config.aliyun;
  return {
    provider: config.provider,
    acme: {
      ...acme,
      hasApiToken: Boolean(apiToken),
      hasAccount: Boolean(accountKeyPem),
      hasFreednsPassword: Boolean(freednsPassword),
      hasFreednsSession: Boolean(freednsSessionCookie),
      hasEabHmacKey: Boolean(eabHmacKey),
    },
    aliyun: { ...aliyun, hasAccessKeySecret: Boolean(accessKeySecret), productCode: FREE_PRODUCT_CODE, order: order ? { id: order.id || null, apiVersion: order.apiVersion || 'v1', domain: order.domain, phase: order.phase, createdAt: order.createdAt, dnsName: order.dnsName || null } : null },
  };
}
