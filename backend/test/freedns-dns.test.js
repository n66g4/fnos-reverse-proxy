import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeDnsClient } from '../lib/freedns-dns.js';

const subdomainHtml = `
<table>
<tr><td>mooo.com</td><td><a href="subdomain/edit.php?edit_domain_id=domain-42">edit</a></td></tr>
<tr><td>TXT</td><td><a href="subdomain/edit.php?data_id=txt-9">_acme-challenge.home.mooo.com</a></td><td><input value="&quot;dns-proof&quot;"></td></tr>
</table>`;

test('FreeDNS login stores session cookie and creates TXT via form API', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/zc.php')) {
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => ['dns_cookie=abc123; Path=/; HttpOnly'] },
        text: async () => 'ok',
      };
    }
    if (url.endsWith('/subdomain/')) {
      return { ok: true, status: 200, headers: {}, text: async () => subdomainHtml };
    }
    if (url.includes('/subdomain/save.php')) {
      return { ok: true, status: 200, headers: {}, text: async () => 'Saved' };
    }
    if (url.includes('/subdomain/edit.php')) {
      return { ok: true, status: 200, headers: {}, text: async () => '<input value="&quot;dns-proof&quot;">' };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const sessions = [];
  const client = new FreeDnsClient({ username: 'user', password: 'secret', fetchFn, onSession: (cookie) => sessions.push(cookie) });
  const record = await client.createTxt('_acme-challenge.home.mooo.com', 'dns-proof');
  assert.equal(record.id, 'txt-9');
  assert.equal(sessions[0], 'dns_cookie=abc123');
  assert.ok(calls.some((item) => item.url.includes('/subdomain/save.php') && item.method === 'POST'));
});

test('FreeDNS deleteTxt matches acme.sh rm (edit page value then delete)', async () => {
  const deleted = [];
  const emptyHtml = '<tr><td>mooo.com</td><td><a href="subdomain/edit.php?edit_domain_id=domain-42">edit</a></td></tr>';
  const fetchFn = async (url) => {
    if (url.includes('/subdomain/delete2.php')) {
      deleted.push(url);
      return { ok: true, status: 200, headers: {}, text: async () => 'ok' };
    }
    if (url.includes('/subdomain/edit.php?data_id=txt-9')) {
      return { ok: true, status: 200, headers: {}, text: async () => '<input value="&quot;dns-proof&quot;">' };
    }
    return { ok: true, status: 200, headers: {}, text: async () => (deleted.length ? emptyHtml : subdomainHtml) };
  };
  const client = new FreeDnsClient({ username: 'user', sessionCookie: 'dns_cookie=abc123', fetchFn });
  await client.deleteTxt('_acme-challenge.home.mooo.com', 'dns-proof');
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /data_id%5B%5D=txt-9/);
});

test('FreeDNS deleteTxt no-ops when TXT value does not match', async () => {
  const fetchFn = async (url) => {
    if (url.includes('/subdomain/edit.php?data_id=txt-9')) {
      return { ok: true, status: 200, headers: {}, text: async () => '<input value="&quot;other&quot;">' };
    }
    return { ok: true, status: 200, headers: {}, text: async () => subdomainHtml };
  };
  const client = new FreeDnsClient({ username: 'user', sessionCookie: 'dns_cookie=abc123', fetchFn });
  await client.deleteTxt('_acme-challenge.home.mooo.com', 'dns-proof');
});

test('FreeDNS deleteRecord removes by id without edit page check', async () => {
  const deleted = [];
  const fetchFn = async (url) => {
    if (url.includes('/subdomain/delete2.php')) {
      deleted.push(url);
      return { ok: true, status: 200, headers: {}, text: async () => 'ok' };
    }
    return { ok: true, status: 200, headers: {}, text: async () => subdomainHtml };
  };
  const client = new FreeDnsClient({ username: 'user', sessionCookie: 'dns_cookie=abc123', fetchFn });
  await client.deleteRecord('txt-9');
  assert.equal(deleted.length, 1);
});

test('FreeDNS invalid login reports password length detail', async () => {
  const fetchFn = async () => ({
    status: 200,
    ok: true,
    headers: { getSetCookie: () => [] },
    text: async () => '<TITLE>Problems!</TITLE><li> Invalid UserID/Pass </li>',
  });
  const client = new FreeDnsClient({ username: 'myuserid', password: 'secret12', fetchFn });
  await assert.rejects(() => client.login(), (error) => {
    assert.equal(error.code, 'FREEDNS_AUTH_INVALID');
    assert.deepEqual(error.detail, { userId: 'myuserid', usernameLength: 8, passwordLength: 8 });
    return true;
  });
});

test('FreeDNS login uses acme.sh style form encoding', async () => {
  let body = '';
  const fetchFn = async (url, options = {}) => {
    if (options.method === 'POST') body = options.body;
    return {
      status: 200,
      ok: true,
      headers: { getSetCookie: () => ['dns_cookie=abc'] },
      text: async () => 'ok',
    };
  };
  const client = new FreeDnsClient({ username: 'user', password: 'a b&c', fetchFn });
  await client.login();
  assert.match(body, /password=a%20b%26c/);
});

test('FreeDNS login exposes site error detail and diagnostic code', async () => {
  const fetchFn = async () => ({
    status: 200,
    ok: true,
    headers: { getSetCookie: () => [] },
    text: async () => '<TITLE>Problems!</TITLE><li>Too many login attempts</li>',
  });
  const client = new FreeDnsClient({ username: 'user', password: 'secret', fetchFn });
  await assert.rejects(() => client.login(), (error) => {
    assert.equal(error.code, 'FREEDNS_AUTH_DENIED');
    assert.match(error.message, /Too many login attempts/);
    return true;
  });
});

test('FreeDNS login collects dns_cookie across redirect hops', async () => {
  const fetchFn = async (url, options = {}) => {
    if (options.method === 'POST') {
      return {
        status: 302,
        ok: false,
        headers: {
          get: (name) => (name.toLowerCase() === 'location' ? '/subdomain/' : null),
          getSetCookie: () => ['dns_cookie=redirect; Path=/; HttpOnly'],
        },
        text: async () => '',
      };
    }
    return { status: 200, ok: true, headers: { getSetCookie: () => [] }, text: async () => subdomainHtml };
  };
  const client = new FreeDnsClient({ username: 'user', password: 'secret', fetchFn });
  const session = await client.login();
  assert.equal(session, 'dns_cookie=redirect');
});

test('FreeDNS retries login when saved session is stale', async () => {
  let loginCalls = 0;
  const fetchFn = async (url, options = {}) => {
    if (url.includes('/zc.php')) {
      loginCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => ['dns_cookie=fresh; Path=/; HttpOnly'] },
        text: async () => 'ok',
      };
    }
    if (url.endsWith('/subdomain/')) {
      const cookie = options.headers?.Cookie || '';
      if (cookie.includes('stale')) {
        return { ok: true, status: 200, headers: {}, text: async () => '<form action="auth"><input name="username"></form>' };
      }
      return { ok: true, status: 200, headers: {}, text: async () => subdomainHtml };
    }
    throw new Error(url);
  };
  const client = new FreeDnsClient({ username: 'user', password: 'secret', sessionCookie: 'dns_cookie=stale', fetchFn });
  await client.loadSubdomainPage();
  assert.equal(loginCalls, 1);
  assert.equal(client.sessionCookie, 'dns_cookie=fresh');
});
