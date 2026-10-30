import AliDns from '@alicloud/alidns20150109';
import OpenApi from '@alicloud/openapi-client';
import Tea from '@alicloud/tea-util';
import Tencent from 'tencentcloud-sdk-nodejs-dnspod';
import { CloudflareDnsClient } from './cloudflare-dns.js';
import { automationError } from './aliyun-client.js';
import { relativeRecord, sameIp, safeDnsError, selectRecord, invalidDnsResponse } from './ddns-providers-core.js';
import {
  CallbackDdnsClient, PorkbunDdnsClient, GoDaddyDdnsClient, NamecheapDdnsClient, NameSiloDdnsClient,
  DeSecDdnsClient, DynadotDdnsClient, DnslaDdnsClient, GcoreDdnsClient, NsOneDdnsClient, RainyunDdnsClient,
  createNowcnClient, createEranetClient, createTnethkClient, HuaweiDdnsClient, BaiduDdnsClient,
  AliyunEsaDdnsClient, EdgeOneDdnsClient,
} from './ddns-providers-http.js';

export { relativeRecord, sameIp } from './ddns-providers-core.js';

export class AliyunDdnsClient {
  constructor(config, { dnsClient } = {}) {
    this.config = config;
    this.client = dnsClient || new AliDns.default(new OpenApi.Config({ accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, regionId: 'cn-hangzhou', endpoint: 'alidns.aliyuncs.com' }));
    this.runtime = new Tea.RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 10_000, readTimeout: 15_000 });
  }
  async call(action, input) {
    try { return (await this.client[`${action[0].toLowerCase()}${action.slice(1)}WithOptions`](new AliDns[`${action}Request`](input), this.runtime)).body; }
    catch (error) { throw safeDnsError(error, '阿里云 DNS '); }
  }
  async inspect({ name, type }) {
    const rr = relativeRecord(name, this.config.dnsZone);
    const body = await this.call('DescribeDomainRecords', { domainName: this.config.dnsZone, RRKeyWord: rr, searchMode: 'COMBINATION', pageSize: 500, pageNumber: 1 });
    const records = body?.domainRecords?.record;
    if (!Array.isArray(records) || !Number.isSafeInteger(body.totalCount) || body.totalCount !== records.length || records.some((record) => !record || !record.RR || !record.type || !record.line)) throw invalidDnsResponse();
    return selectRecord(records.map((record) => ({ id: record.recordId, name: record.RR, type: record.type, line: record.line, value: record.value, ttl: record.TTL, status: record.status, locked: record.locked, weight: record.lbaStatus ? 1 : 0 })), { rr, type, line: this.config.line || 'default' });
  }
  async upsert({ name, type, content, ttl }) {
    const record = await this.inspect({ name, type });
    if (record && sameIp(record.value, content) && record.ttl === ttl) return { changed: false };
    const body = await this.call(record ? 'UpdateDomainRecord' : 'AddDomainRecord', {
      ...(record ? { recordId: record.id } : { domainName: this.config.dnsZone }),
      RR: relativeRecord(name, this.config.dnsZone), type, value: content, TTL: ttl, line: this.config.line || 'default',
    });
    if (!body?.recordId || record && String(body.recordId) !== String(record.id)) throw automationError('云端未确认目标记录已更新，下次同步将先核对现有记录', 502);
    return { changed: true };
  }
}

export class DnspodDdnsClient {
  constructor(config, { dnsClient } = {}) {
    this.config = config;
    this.client = dnsClient || new Tencent.dnspod.v20210323.Client({
      credential: { secretId: config.secretId, secretKey: config.secretKey },
      profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { endpoint: 'dnspod.tencentcloudapi.com', protocol: 'https://', reqMethod: 'POST', reqTimeout: 15 } },
    });
  }
  async call(action, input) {
    try { return await this.client[action](input); }
    catch (error) { throw safeDnsError(error, '腾讯云 DNSPod '); }
  }
  async inspect({ name, type }) {
    const rr = relativeRecord(name, this.config.dnsZone);
    const body = await this.call('DescribeRecordList', { Domain: this.config.dnsZone, SubDomain: rr, Offset: 0, Limit: 3000, ErrorOnEmpty: 'no' });
    const records = body?.RecordList;
    const total = body?.RecordCountInfo?.TotalCount;
    if (!Array.isArray(records) || !Number.isSafeInteger(total) || total !== records.length || records.some((record) => !record || !record.Name || !record.Type || !record.Line || !Number.isSafeInteger(record.RecordId) || record.RecordId <= 0)) throw invalidDnsResponse();
    return selectRecord(records.map((record) => ({ id: record.RecordId, name: record.Name, type: record.Type, line: record.Line, value: record.Value, ttl: record.TTL, status: record.Status, weight: record.Weight })), { rr, type, line: this.config.line || '默认' });
  }
  async upsert({ name, type, content, ttl }) {
    const record = await this.inspect({ name, type });
    if (record && sameIp(record.value, content) && record.ttl === ttl) return { changed: false };
    const body = await this.call(record ? 'ModifyRecord' : 'CreateRecord', {
      Domain: this.config.dnsZone, SubDomain: relativeRecord(name, this.config.dnsZone), RecordType: type,
      RecordLine: this.config.line || '默认', Value: content, TTL: ttl, ...(record ? { RecordId: record.id } : {}),
    });
    if (!Number.isSafeInteger(body?.RecordId) || body.RecordId <= 0 || record && body.RecordId !== record.id) throw automationError('云端未确认目标记录已更新，下次同步将先核对现有记录', 502);
    return { changed: true };
  }
}

function taskFromConfig(config) {
  if (config?.credentials && config?.provider) return config;
  if (Array.isArray(config?.tasks) && config.tasks[0]) return config.tasks[0];
  // Legacy flat config from older callers / tests
  if (config?.provider === 'aliyun') return { provider: 'aliyun', credentials: config.aliyun, ttl: config.ttl };
  if (config?.provider === 'dnspod' || config?.provider === 'tencentcloud') {
    return { provider: config.provider === 'dnspod' ? 'dnspod' : 'tencentcloud', credentials: config.dnspod || config.credentials, ttl: config.ttl };
  }
  if (config?.provider === 'cloudflare' || config?.zoneId) {
    return { provider: 'cloudflare', credentials: { zoneId: config.zoneId, apiToken: config.apiToken, proxied: config.proxied }, ttl: config.ttl };
  }
  return config;
}

export function createDdnsClient(config, { fetchFn = globalThis.fetch } = {}) {
  const task = taskFromConfig(config);
  const provider = task?.provider;
  const credentials = task?.credentials || {};
  if (provider === 'aliyun') return new AliyunDdnsClient(credentials);
  if (provider === 'tencentcloud' || provider === 'dnspod') {
    if (credentials.secretId && credentials.secretKey) return new DnspodDdnsClient(credentials);
    if (credentials.id && credentials.token) {
      const line = encodeURIComponent(credentials.line || '默认');
      return new CallbackDdnsClient({
        url: `https://dnsapi.cn/Record.Ddns?login_token=${encodeURIComponent(`${credentials.id},${credentials.token}`)}&format=json&domain=${encodeURIComponent(credentials.dnsZone || '')}&sub_domain=#{domain}&record_type=#{recordType}&value=#{ip}&record_line=${line}`,
        requestBody: '',
        headers: '',
      }, { fetchFn });
    }
    return new DnspodDdnsClient(credentials);
  }
  if (provider === 'cloudflare') return new CloudflareDnsClient({ zoneId: credentials.zoneId, apiToken: credentials.apiToken, fetchFn });
  if (provider === 'callback') return new CallbackDdnsClient(credentials, { fetchFn });
  if (provider === 'porkbun') return new PorkbunDdnsClient(credentials, { fetchFn });
  if (provider === 'godaddy') return new GoDaddyDdnsClient(credentials, { fetchFn });
  if (provider === 'namecheap') return new NamecheapDdnsClient(credentials, { fetchFn });
  if (provider === 'namesilo') return new NameSiloDdnsClient(credentials, { fetchFn });
  if (provider === 'desec') return new DeSecDdnsClient(credentials, { fetchFn });
  if (provider === 'dynadot') return new DynadotDdnsClient(credentials, { fetchFn });
  if (provider === 'dnsla') return new DnslaDdnsClient(credentials, { fetchFn });
  if (provider === 'gcore') return new GcoreDdnsClient(credentials, { fetchFn });
  if (provider === 'nsone') return new NsOneDdnsClient(credentials, { fetchFn });
  if (provider === 'rainyun') return new RainyunDdnsClient(credentials, { fetchFn });
  if (provider === 'nowcn') return createNowcnClient(credentials, { fetchFn });
  if (provider === 'eranet') return createEranetClient(credentials, { fetchFn });
  if (provider === 'tnethk') return createTnethkClient(credentials, { fetchFn });
  if (provider === 'huaweicloud') return new HuaweiDdnsClient(credentials, { fetchFn });
  if (provider === 'baiducloud') return new BaiduDdnsClient(credentials, { fetchFn });
  if (provider === 'aliyun_esa') return new AliyunEsaDdnsClient({ ...credentials, customUrl: task.customParams }, { fetchFn });
  if (provider === 'edgeone') return new EdgeOneDdnsClient(credentials, { fetchFn });
  throw automationError('不支持的 DDNS 服务商');
}
