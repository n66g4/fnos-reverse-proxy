import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigStore } from '../lib/config-store.js';

test('clears FreeDNS session when password changes and validates ZeroSSL auto-renew', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reverse-proxy-issuance-config-'));
  const store = new ConfigStore(directory);
  try {
    store.load();
    store.updateIssuance({
      provider: 'acme',
      acme: {
        dnsProvider: 'freedns',
        freednsUsername: 'user',
        freednsPassword: 'secret-one',
        freednsSessionCookie: 'dns_cookie=old',
        email: 'admin@example.com',
        domains: ['home.example.com'],
      },
    });
    store.updateIssuance({ acme: { freednsPassword: 'secret-two' } });
    assert.equal(store.issuanceConfig().acme.freednsSessionCookie, '');
    assert.throws(() => store.updateIssuance({
      provider: 'zerossl',
      acme: { autoRenew: true, eabKid: 'kid', email: 'admin@example.com', domains: ['home.example.com'], dnsProvider: 'freedns', freednsUsername: 'user' },
    }), /EAB/);
    store.updateIssuance({
      provider: 'zerossl',
      acme: { autoRenew: true, eabKid: 'kid', eabHmacKey: 'hmac', email: 'admin@example.com', domains: ['home.example.com'], dnsProvider: 'freedns', freednsUsername: 'user', freednsPassword: 'secret-two' },
    });
    assert.equal(store.issuanceConfig().provider, 'zerossl');
    assert.equal(store.issuanceStatus().acme.hasEabHmacKey, true);
    assert.equal(JSON.stringify(store.issuanceStatus()).includes('hmac'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit clearFreednsSessionCookie removes saved session', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reverse-proxy-issuance-session-'));
  const store = new ConfigStore(directory);
  try {
    store.load();
    store.updateIssuance({ acme: { freednsSessionCookie: 'dns_cookie=keep', freednsUsername: 'user', freednsPassword: 'secret' } });
    store.updateIssuance({ acme: { clearFreednsSessionCookie: true } });
    assert.equal(store.issuanceConfig().acme.freednsSessionCookie, '');
    assert.equal(store.issuanceStatus().acme.hasFreednsSession, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
