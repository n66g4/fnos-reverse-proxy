import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigStore } from '../lib/config-store.js';
import { DdnsService } from '../lib/ddns-service.js';
import { createDdnsClient } from '../lib/ddns-providers.js';
import { CallbackDdnsClient } from '../lib/ddns-providers-http.js';
import { resolveFromUrls, resolveFromInterfaces, listNetworkInterfaces, isPublicAddress } from '../lib/ddns-ip.js';
import { migrateFlatDdns, normalizeDdns, DDNS_PROVIDERS } from '../lib/ddns-schema.js';

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverse-proxy-ddns-v2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ConfigStore(dir);
  store.load();
  return store;
}

test('flat v1 DDNS migrates into a single v2 task with pools', () => {
  const migrated = migrateFlatDdns({
    provider: 'cloudflare',
    zoneId: '023e105f4ecef8ad9ca31a8372d0c353',
    apiToken: 'secret-token',
    enabled: true,
    recordName: 'home.example.com',
    recordType: 'A',
    intervalMinutes: 15,
    aliyun: { accessKeyId: 'ak', accessKeySecret: 'sk', dnsZone: 'example.com', line: 'default' },
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.intervalSeconds, 900);
  assert.equal(migrated.tasks.length, 1);
  assert.equal(migrated.tasks[0].provider, 'cloudflare');
  assert.deepEqual(migrated.tasks[0].ipv4.domains, ['home.example.com']);
  assert.equal(migrated.pools.aliyun.accessKeySecret, 'sk');
  assert.equal(migrated.pools.cloudflare.apiToken, 'secret-token');
});

test('multi-task save keeps secrets write-only and supports dual-stack domains', (t) => {
  const store = tempStore(t);
  const saved = store.updateDdns({
    intervalSeconds: 120,
    cacheTimes: 2,
    webhook: { enabled: false, url: '', requestBody: '', headers: '' },
    tasks: [{
      name: 'home',
      enabled: true,
      provider: 'cloudflare',
      ttl: 1,
      credentials: { zoneId: '023e105f4ecef8ad9ca31a8372d0c353', apiToken: 'cf-secret', proxied: false },
      ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['a.example.com', 'b.example.com'] },
      ipv6: { enabled: true, getType: 'url', urls: ['https://api6.ipify.org'], domains: ['v6.example.com'] },
    }, {
      name: 'callback',
      enabled: false,
      provider: 'callback',
      ttl: 600,
      credentials: { url: 'https://example.com/ddns?ip=#{ip}', requestBody: '', headers: '' },
      ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['cb.example.com'] },
      ipv6: { enabled: false, getType: 'url', urls: ['https://api6.ipify.org'], domains: [] },
    }],
  });
  assert.equal(saved.tasks.length, 2);
  assert.equal(saved.tasks[0].credentials.hasApiToken, true);
  assert.equal(Object.hasOwn(saved.tasks[0].credentials, 'apiToken'), false);
  assert.equal(JSON.stringify(saved).includes('cf-secret'), false);
  assert.equal(store.ddnsConfig().tasks[0].credentials.apiToken, 'cf-secret');
  assert.ok(Object.keys(DDNS_PROVIDERS).includes('callback'));
});

test('public IP helpers validate families and can read url responses', async () => {
  assert.equal(isPublicAddress('8.8.8.8', 'A'), true);
  assert.equal(isPublicAddress('192.168.1.1', 'A'), false);
  assert.equal(isPublicAddress('2001:db8::1', 'AAAA'), true);
  const result = await resolveFromUrls('A', ['https://api.ipify.org'], {
    fetchFn: async () => ({ ok: true, json: async () => ({ ip: '1.1.1.1' }) }),
  });
  assert.equal(result.ip, '1.1.1.1');
  assert.ok(Array.isArray(listNetworkInterfaces()));
  assert.throws(() => resolveFromInterfaces('A', 'definitely-missing-iface-xyz'));
});

test('Callback provider replaces variables and posts body', async () => {
  const calls = [];
  const client = new CallbackDdnsClient({
    url: 'https://hook.test/update?host=#{domain}',
    requestBody: '{"ip":"#{ip}","type":"#{recordType}"}',
    headers: 'X-Token: abc',
  }, {
    fetchFn: async (url, options) => {
      calls.push({ url, ...options });
      return { ok: true, status: 200, text: async () => 'ok' };
    },
  });
  const result = await client.upsert({ name: 'home.example.com', type: 'A', content: '203.0.113.9', ttl: 600 });
  assert.equal(result.changed, true);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /host=home\.example\.com/);
  assert.match(calls[0].body, /203\.0\.113\.9/);
});

test('scheduler syncs one task, writes logs, and fires webhook', async (t) => {
  const store = tempStore(t);
  store.updateDdns({
    intervalSeconds: 60,
    webhook: { enabled: true, url: 'https://hook.test/?ip=#{ipv4Addr}&result=#{ipv4Result}', requestBody: '', headers: '' },
    tasks: [{
      name: 'main',
      enabled: true,
      provider: 'callback',
      ttl: 600,
      credentials: { url: 'https://dns.test/#{ip}', requestBody: '', headers: '' },
      ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['home.example.com'] },
      ipv6: { enabled: false, getType: 'url', urls: [], domains: [] },
    }],
  });
  const hooks = [];
  const service = new DdnsService({
    store,
    clientFactory: () => ({
      inspect: async () => null,
      upsert: async () => ({ changed: true }),
    }),
    fetchFn: async (url) => {
      hooks.push(url);
      if (String(url).includes('api.ipify')) return { ok: true, json: async () => ({ ip: '203.0.113.10' }) };
      return { ok: true, status: 200, text: async () => 'ok' };
    },
  });
  const result = await service.sync({ publicIp: '203.0.113.10' });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.ok(store.ddnsStatus().logs.length >= 1);
  assert.ok(hooks.some((url) => String(url).includes('hook.test') && String(url).includes('203.0.113.10')));
});

test('createDdnsClient accepts task objects for every registered provider key', () => {
  for (const provider of Object.keys(DDNS_PROVIDERS)) {
    const credentials = provider === 'cloudflare'
      ? { zoneId: '023e105f4ecef8ad9ca31a8372d0c353', apiToken: 'x' }
      : provider === 'callback' || provider === 'edgeone'
        ? { url: 'https://example.com/#{ip}' }
        : provider === 'namecheap'
          ? { password: 'x', dnsZone: 'example.com' }
          : provider === 'desec'
            ? { token: 'x', dnsZone: 'example.com' }
            : ['nsone', 'gcore', 'rainyun'].includes(provider)
              ? { apiKey: 'x', dnsZone: 'example.com' }
              : provider === 'huaweicloud'
                ? { id: 'project', secret: 'token', dnsZone: 'zone-id' }
                : provider === 'aliyun' || provider === 'aliyun_esa' || provider === 'baiducloud'
                  ? { accessKeyId: 'id', accessKeySecret: 'secret', dnsZone: 'example.com' }
                  : provider === 'tencentcloud' || provider === 'dnspod'
                    ? { secretId: 'id', secretKey: 'secret', dnsZone: 'example.com' }
                    : { id: 'id', secret: 'secret', dnsZone: 'example.com' };
    assert.ok(createDdnsClient({ provider, credentials, customParams: 'https://esa.example/#{ip}' }));
  }
});

test('tick only syncs ready due tasks with per-task forced IPs', async (t) => {
  const store = tempStore(t);
  store.updateDdns({
    intervalSeconds: 60,
    cacheTimes: 1,
    tasks: [
      {
        name: 'a', enabled: true, provider: 'callback', ttl: 600,
        credentials: { url: 'https://a.test/#{ip}' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['a.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
      {
        name: 'b', enabled: true, provider: 'callback', ttl: 600,
        credentials: { url: 'https://b.test/#{ip}' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['b.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
    ],
  });
  // Make only first task due by faking lastRunAt on second.
  const cfg = store.ddnsConfig();
  cfg.tasks[1].lastRunAt = new Date().toISOString();
  store.data.integrations.ddns = cfg;
  store.save();

  const upserts = [];
  const service = new DdnsService({
    store,
    clientFactory: (task) => ({
      inspect: async () => null,
      upsert: async (args) => { upserts.push({ taskId: task.id, ...args }); return { changed: true }; },
    }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ip: '203.0.113.50' }) }),
  });
  await service.tick();
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].content, '203.0.113.50');
  assert.equal(upserts[0].name, 'a.example.com');
});

test('huawei and edgeone credentials round-trip through normalize', (t) => {
  const store = tempStore(t);
  const saved = store.updateDdns({
    tasks: [
      {
        name: 'hw', provider: 'huaweicloud', enabled: false, ttl: 600,
        credentials: { id: 'proj-1', secret: 'token-1', dnsZone: 'zone-1' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['hw.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
      {
        name: 'eo', provider: 'edgeone', enabled: false, ttl: 600,
        credentials: { url: 'https://eo.test?ip=#{ip}', requestBody: '', headers: '' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['eo.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
    ],
  });
  const hw = store.ddnsConfig().tasks.find((task) => task.name === 'hw');
  const eo = store.ddnsConfig().tasks.find((task) => task.name === 'eo');
  assert.equal(hw.credentials.id, 'proj-1');
  assert.equal(hw.credentials.secret, 'token-1');
  assert.equal(eo.credentials.url, 'https://eo.test?ip=#{ip}');
  assert.equal(saved.tasks.find((task) => task.name === 'hw').credentials.hasSecret, true);
  assert.equal(Object.hasOwn(saved.tasks.find((task) => task.name === 'eo').credentials, 'url'), true);
});

test('Callback upsert reports unchanged when previous IP matches', async () => {
  const calls = [];
  const client = new CallbackDdnsClient({ url: 'https://hook.test/#{ip}' }, {
    fetchFn: async (url) => { calls.push(url); return { ok: true, status: 200, text: async () => 'ok' }; },
  });
  assert.equal((await client.upsert({ name: 'x.example.com', type: 'A', content: '1.1.1.1', ttl: 600, previous: '1.1.1.1' })).changed, false);
  assert.equal(calls.length, 0);
  assert.equal((await client.upsert({ name: 'x.example.com', type: 'A', content: '1.1.1.2', ttl: 600, previous: '1.1.1.1' })).changed, true);
  assert.equal(calls.length, 1);
});

test('normalizeDdns is idempotent for already-migrated documents', () => {
  const once = normalizeDdns({
    version: 2,
    tasks: [{ provider: 'godaddy', credentials: { id: 'a', secret: 'b', dnsZone: 'example.com' }, ipv4: { enabled: true, domains: ['home.example.com'] } }],
  });
  const twice = normalizeDdns(once);
  assert.equal(twice.tasks[0].provider, 'godaddy');
  assert.equal(twice.tasks[0].id, once.tasks[0].id);
});

test('legacy intervalMinutes patch keeps sibling tasks and domains', (t) => {
  const store = tempStore(t);
  store.updateDdns({
    intervalSeconds: 300,
    tasks: [
      {
        name: 'primary', enabled: true, provider: 'callback', ttl: 600,
        credentials: { url: 'https://a.test/#{ip}' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['a.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
      {
        name: 'sibling', enabled: false, provider: 'callback', ttl: 600,
        credentials: { url: 'https://b.test/#{ip}' },
        ipv4: { enabled: true, getType: 'url', urls: ['https://api.ipify.org'], domains: ['b.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
    ],
  });
  const before = store.ddnsConfig();
  assert.equal(before.taskCount, 2);
  store.updateDdns({ intervalMinutes: 20 });
  const after = store.ddnsConfig();
  assert.equal(after.intervalMinutes, 20);
  assert.equal(after.tasks.length, 2);
  assert.equal(after.tasks[0].ipv4.domains[0], 'a.example.com');
  assert.equal(after.tasks[1].name, 'sibling');
  assert.equal(after.tasks[1].ipv4.domains[0], 'b.example.com');
  assert.equal(after.legacyTaskId, before.legacyTaskId);
});

test('recordDdnsResult patches primary runtime without dropping sibling tasks', (t) => {
  const store = tempStore(t);
  store.updateDdns({
    tasks: [
      {
        name: 'one', enabled: true, provider: 'callback', ttl: 600,
        credentials: { url: 'https://a.test/#{ip}' },
        ipv4: { enabled: true, domains: ['a.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
      {
        name: 'two', enabled: false, provider: 'callback', ttl: 600,
        credentials: { url: 'https://b.test/#{ip}' },
        ipv4: { enabled: true, domains: ['b.example.com'] },
        ipv6: { enabled: false, domains: [] },
      },
    ],
  });
  const primaryId = store.ddnsConfig().tasks[0].id;
  store.recordDdnsResult({ ok: true, taskId: primaryId, ip: '203.0.113.8', ipv4: '203.0.113.8', changed: true });
  const cfg = store.ddnsConfig();
  assert.equal(cfg.tasks.length, 2);
  assert.equal(cfg.tasks[0].lastIpv4, '203.0.113.8');
  assert.equal(cfg.tasks[1].name, 'two');
  assert.ok(cfg.logs.length >= 1);
  store.appendDdnsLogEntry({ level: 'info', message: 'manual note' });
  assert.equal(store.ddnsConfig().tasks.length, 2);
  assert.ok(store.ddnsConfig().logs.some((item) => item.message === 'manual note'));
});
