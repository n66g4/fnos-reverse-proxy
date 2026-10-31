import test from 'node:test';
import assert from 'node:assert/strict';
import { DdnsService } from '../lib/ddns-service.js';

const store = { ddnsConfig: () => ({ recordType: 'A' }), recordDdnsResult: () => assert.fail('detection must not write sync history') };
test('public IP detection needs no DNS credentials and never calls a provider', async () => {
  const urls = [];
  const service = new DdnsService({
    store,
    clientFactory: () => assert.fail('no DNS client'),
    fetchFn: async (url) => {
      urls.push(url);
      return { ok: true, text: async () => 'Current IP Address: 8.8.8.8' };
    },
  });
  const result = await service.detect();
  assert.equal(result.ip, '8.8.8.8');
  assert.equal(result.source, 'ddns.oray.com');
  assert.ok(result.detectedAt);
  assert.equal(urls[0], 'https://ddns.oray.com/checkip');
  assert.equal(service.detectionStatus().results.A.ip, '8.8.8.8');
});
test('IPv6 uses its own endpoint and is kept separate from IPv4', async () => {
  const urls = [];
  const service = new DdnsService({
    store,
    fetchFn: async (url) => {
      urls.push(url);
      return { ok: true, text: async () => (url.includes('api6') || url.includes('ipv6') || url.includes('v6.') ? '2606:4700:4700::1111' : '8.8.4.4') };
    },
  });
  await service.detect('A');
  await service.detect('AAAA');
  assert.equal(urls[0], 'https://ddns.oray.com/checkip');
  assert.equal(urls[1], 'https://api6.ipify.org?format=json');
  assert.equal(service.detectionStatus().results.A.ip, '8.8.4.4');
  assert.equal(service.detectionStatus().results.AAAA.ip, '2606:4700:4700::1111');
});
test('detection falls back when the first IP interface is unreachable', async () => {
  const urls = [];
  const service = new DdnsService({
    store,
    fetchFn: async (url) => {
      urls.push(url);
      if (url.includes('oray.com')) throw new Error('blocked');
      return { ok: true, text: async () => '203.0.113.9\n' };
    },
  });
  const result = await service.detect('A');
  assert.equal(result.ip, '203.0.113.9');
  assert.ok(urls.length >= 2);
  assert.match(urls[1], /3322\.net|ipip\.net|ipify|icanhazip/);
});
test('invalid, mismatched, private and failed IP responses cannot become detected addresses', async () => {
  for (const ip of ['bad', '::1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '10.1.1.1', '224.1.1.1']) {
    const service = new DdnsService({ store, fetchFn: async () => ({ ok: true, json: async () => ({ ip }) }) });
    await assert.rejects(service.detect('A'), /检测失败/); assert.equal(service.detectionStatus().results.A.ip, undefined);
  }
});
test('detection rejects arbitrary endpoints/types, deduplicates clicks and labels stale results', async () => {
  let respond; let count = 0;
  const service = new DdnsService({ store, fetchFn: async () => { count++; return new Promise((resolve) => { respond = resolve; }); } });
  await assert.rejects(service.detect('https://evil.test'), /请选择/); assert.equal(count, 0);
  const first = service.detect('A'); const second = service.detect('A');
  assert.equal(first, second); respond({ ok: true, text: async () => '8.8.8.8' }); await first;
  service.fetchFn = async () => { throw new Error('sensitive response'); };
  await assert.rejects(service.detect('A'), /检测失败/);
  const result = service.detectionStatus().results.A; assert.equal(result.ip, '8.8.8.8'); assert.ok(result.error); assert.equal(result.error.includes('sensitive'), false);
});
test('demo detection never reaches the network or invents a public IP', async () => {
  const service = new DdnsService({ store, demoMode: true, fetchFn: () => assert.fail('no network') });
  const result = await service.detect('A'); assert.equal(result.demoMode, true); assert.equal(result.ip, undefined);
});
