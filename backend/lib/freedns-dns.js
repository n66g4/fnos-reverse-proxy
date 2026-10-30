const BASE = 'https://freedns.afraid.org';
const USER_AGENT = 'Mozilla/5.0 (compatible; fnos-reverse-proxy/1; +https://github.com/n66g4/fnos-reverse-proxy)';
const clean = (value) => String(value ?? '').trim();
const integrationError = (message, status = 502, code = '') => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

function parseFreednsPageErrors(html) {
  const items = [];
  for (const match of String(html).matchAll(/<li>\s*([^<]+)/gi)) {
    const line = clean(match[1].replace(/<[^>]+>/g, ' '));
    if (line) items.push(line);
  }
  return items;
}

function freednsAuthMessage(text, fallback) {
  const detail = parseFreednsPageErrors(text).find((line) => !/^click here|^back$/i.test(line));
  if (!detail) return fallback;
  if (/Invalid UserID\/Pass/i.test(detail)) return fallback;
  return `FreeDNS 登录失败：${detail.slice(0, 240)}`;
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compactHtml = (html) => html.replace(/[\s\t\r\n\v\f]/g, '');

export function normalizeFreednsUsername(value) {
  return clean(value).replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function loginFormBody(username, password) {
  return `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&submit=${encodeURIComponent('Login')}&action=auth`;
}

function splitDomainLabels(fulldomain) {
  const parts = clean(fulldomain).toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  const candidates = [];
  for (let i = 1; i < parts.length; i += 1) {
    candidates.push({ subdomain: parts.slice(0, i).join('.'), topDomain: parts.slice(i).join('.') });
  }
  return candidates;
}

function extractCookie(setCookies) {
  for (const header of setCookies) {
    const match = header.match(/dns_cookie=[^;]+/i);
    if (match) return match[0];
  }
  return '';
}

function responseSetCookies(response) {
  const headers = response.headers;
  if (!headers) return [];
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (list.length) return list;
  if (typeof headers.get === 'function') {
    const single = headers.get('set-cookie');
    return single ? [single] : [];
  }
  return [];
}

function isInvalidCredentials(html) {
  return /Invalid UserID\/Pass/i.test(html);
}

function resolveUrl(location) {
  const target = clean(location);
  if (!target) return `${BASE}/`;
  if (/^https?:\/\//i.test(target)) return target;
  return `${BASE}${target.startsWith('/') ? target : `/${target}`}`;
}

function isLoginPage(html) {
  return /action=auth|name="username"|login to freedns|please log in/i.test(html);
}

function isSubdomainList(html) {
  return html.includes('edit_domain_id=') || html.includes('edit.php?data_id=');
}

function assertHttpOk(response, context) {
  if (response.status !== 200) throw integrationError(`FreeDNS ${context} 返回 HTTP ${response.status}`, 502);
}

function assertSaveResponse(text) {
  if (text.includes('security code was incorrect')) {
    throw integrationError('FreeDNS 公共域需要安全码，无法自动完成 DNS-01 验证', 409, 'FREEDNS_PUBLIC_DOMAIN_SECURITY');
  }
  if (isLoginPage(text)) {
    throw Object.assign(integrationError('FreeDNS 会话已失效', 401, 'FREEDNS_SESSION_EXPIRED'), { reauth: true });
  }
  if (/error|denied|failed|invalid/i.test(text) && !/saved|added|updated|success/i.test(text)) {
    const detail = parseFreednsPageErrors(text)[0];
    throw integrationError(detail ? `FreeDNS 未能写入 TXT 验证记录：${detail.slice(0, 200)}` : 'FreeDNS 未能写入 TXT 验证记录', 502, 'FREEDNS_TXT_SAVE_FAILED');
  }
}

function txtValueOnEditPage(html, content) {
  return html.includes(`value="&quot;${content}&quot;"`) || html.includes(`value='&quot;${content}&quot;'`);
}

export class FreeDnsClient {
  constructor({ username, password, sessionCookie = '', fetchFn = globalThis.fetch, onSession }) {
    this.username = normalizeFreednsUsername(username);
    this.password = password;
    this.sessionCookie = clean(sessionCookie);
    this.fetchFn = fetchFn;
    this.onSession = onSession;
    this.subdomainHtml = '';
  }

  invalidateSession() {
    this.sessionCookie = '';
    this.subdomainHtml = '';
    void this.onSession?.('');
  }

  async request(path, { method = 'GET', body, cookie } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    timeout.unref?.();
    try {
      const response = await this.fetchFn(`${BASE}${path}`, {
        method,
        headers: {
          'Accept-Language': 'en-US',
          'User-Agent': USER_AGENT,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: body ? body.toString() : undefined,
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw integrationError(`FreeDNS 返回 ${response.status}`, 502);
      return { response, text };
    } catch (error) {
      if (error.status) throw error;
      throw integrationError(error?.name === 'AbortError' ? 'FreeDNS 请求超时' : `无法连接 FreeDNS：${clean(error?.message) || '未知错误'}`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async login() {
    if (!this.username || !this.password) {
      throw integrationError('FreeDNS 会话已失效，请重新保存用户名和密码', 401, 'FREEDNS_AUTH_NO_PASSWORD');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    timeout.unref?.();
    let url = `${BASE}/zc.php?step=2`;
    let method = 'POST';
    let postBody = loginFormBody(this.username, this.password);
    let session = '';
    let text = '';
    try {
      for (let hop = 0; hop < 8; hop += 1) {
        const response = await this.fetchFn(url, {
          method,
          headers: {
            'Accept-Language': 'en-US',
            'User-Agent': USER_AGENT,
            ...(postBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: postBody || undefined,
          redirect: 'manual',
          signal: controller.signal,
        });
        session = extractCookie(responseSetCookies(response)) || session;
        if (response.status >= 300 && response.status < 400) {
          url = resolveUrl(typeof response.headers?.get === 'function' ? response.headers.get('location') : '');
          method = 'GET';
          postBody = null;
          continue;
        }
        text = await response.text();
        if (response.status !== 200) throw integrationError(`FreeDNS 登录返回 HTTP ${response.status}`, 502, 'FREEDNS_AUTH_HTTP');
        break;
      }
    } catch (error) {
      if (error.status) throw error;
      const code = error?.name === 'AbortError' ? 'FREEDNS_NETWORK_TIMEOUT' : 'FREEDNS_NETWORK';
      throw integrationError(error?.name === 'AbortError' ? 'FreeDNS 请求超时' : `无法连接 FreeDNS：${clean(error?.message) || '未知错误'}`, 502, code);
    } finally {
      clearTimeout(timeout);
    }
    if (session) {
      this.sessionCookie = session;
      await this.onSession?.(session);
      return session;
    }
    if (isInvalidCredentials(text)) {
      const detail = { userId: this.username, usernameLength: this.username.length, passwordLength: String(this.password ?? '').length };
      let message = `FreeDNS 登录失败：afraid.org 拒绝了 UserID「${this.username}」与当前保存的密码（${detail.passwordLength} 字符）。若网页能登录，请在设置中重新输入密码并保存，不要留空。`;
      if (detail.passwordLength === 0) message = 'FreeDNS 登录失败：NAS 未读取到已保存密码。请在设置中重新输入密码并保存后再试。';
      else if (this.username.includes('@')) message = 'FreeDNS 登录失败：用户名含 @，疑似邮箱。请填写 afraid.org 的 UserID（非邮箱）。';
      throw Object.assign(integrationError(message, 401, 'FREEDNS_AUTH_INVALID'), { detail });
    }
    if (isLoginPage(text) || /<TITLE>Problems!/i.test(text)) {
      throw integrationError(freednsAuthMessage(text, 'FreeDNS 登录被拒绝，请稍后重试或在设置中清除会话后重新保存密码'), 502, 'FREEDNS_AUTH_DENIED');
    }
    throw integrationError('FreeDNS 登录成功但未收到会话 Cookie，请清除 FreeDNS 会话后重试', 502, 'FREEDNS_AUTH_NO_COOKIE');
  }

  async ensureCookie({ renew = false } = {}) {
    if (renew) this.invalidateSession();
    if (this.sessionCookie) return this.sessionCookie;
    return this.login();
  }

  async runAuthenticated(work) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const cookie = await this.ensureCookie({ renew: attempt > 0 });
        return await work(cookie);
      } catch (error) {
        if (attempt === 0 && (error.reauth || error.status === 401)) {
          this.invalidateSession();
          continue;
        }
        throw error;
      }
    }
    throw integrationError('FreeDNS 会话已失效，请重新保存密码后重试', 401);
  }

  async loadSubdomainPage(force = false) {
    if (this.subdomainHtml && !force) return this.subdomainHtml;
    return this.runAuthenticated(async (cookie) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { text } = await this.request('/subdomain/', { cookie });
        if (isSubdomainList(text)) {
          this.subdomainHtml = text;
          return text;
        }
        if (isLoginPage(text)) throw Object.assign(integrationError('FreeDNS 会话已失效', 401), { reauth: true });
      }
      throw integrationError('无法读取 FreeDNS 子域列表，请稍后重试', 502);
    });
  }

  findDomainId(topDomain, html) {
    const compact = compactHtml(html);
    const pattern = new RegExp(`<td>${escapeRegex(topDomain)}(?:\\([^)]*\\))?</td>[\\s\\S]*?edit_domain_id=([0-9a-zA-Z_-]+)`, 'i');
    const match = compact.match(pattern);
    return match?.[1] || '';
  }

  findTxtDataIds(fulldomain, html) {
    const searchDomain = escapeRegex(fulldomain.toLowerCase().replace(/\.$/, ''));
    const anchor = new RegExp(`<ahref[^>]*>${searchDomain}<\\/a>`, 'i');
    return compactHtml(html).split('<tr>').filter((row) => /<td[a-zA-Z=#]*>TXT<\/td>/i.test(row) && anchor.test(row))
      .map((row) => row.match(/edit\.php\?data_id=([0-9a-zA-Z_-]+)/)?.[1]).filter(Boolean);
  }

  async loadEditPage(dataId, cookie) {
    const { text } = await this.request(`/subdomain/edit.php?data_id=${encodeURIComponent(dataId)}`, { cookie });
    if (isLoginPage(text)) throw Object.assign(integrationError('FreeDNS 会话已失效', 401), { reauth: true });
    return text;
  }

  async resolveTxtRecordId(fulldomain, content, cookie) {
    const html = await this.loadSubdomainPage(true);
    const ids = this.findTxtDataIds(fulldomain, html);
    for (const id of ids) {
      const editPage = await this.loadEditPage(id, cookie);
      if (txtValueOnEditPage(editPage, content)) return id;
    }
    return '';
  }

  async resolveDomain(fulldomain) {
    const html = await this.loadSubdomainPage();
    for (const { subdomain, topDomain } of splitDomainLabels(fulldomain)) {
      const domainId = this.findDomainId(topDomain, html);
      if (domainId) return { subdomain, topDomain, domainId };
    }
    throw integrationError(`在 FreeDNS 账户中未找到 ${fulldomain} 对应的托管域`, 404, 'FREEDNS_DOMAIN_NOT_FOUND');
  }

  async createTxt(name, content) {
    return this.runAuthenticated(async (cookie) => {
      const { subdomain, domainId } = await this.resolveDomain(name);
      const body = new URLSearchParams({
        type: 'TXT',
        domain_id: domainId,
        subdomain,
        address: `"${content}"`,
        send: 'Save!',
      });
      const { response, text } = await this.request('/subdomain/save.php?step=2', { method: 'POST', body, cookie });
      assertHttpOk(response, '保存 TXT');
      assertSaveResponse(text);
      this.subdomainHtml = '';
      const id = await this.resolveTxtRecordId(name, content, cookie);
      if (!id) throw integrationError('FreeDNS TXT 记录已提交但未找到匹配的 record id', 502);
      return { id, name, value: content, subdomain };
    });
  }

  async deleteTxt(fulldomain, content) {
    await this.runAuthenticated(async (cookie) => {
      const html = await this.loadSubdomainPage(true);
      const ids = this.findTxtDataIds(fulldomain, html);
      if (!ids.length) return;
      for (const id of ids) {
        const editPage = await this.loadEditPage(id, cookie);
        if (!txtValueOnEditPage(editPage, content)) continue;
        const { response } = await this.request(`/subdomain/delete2.php?data_id%5B%5D=${encodeURIComponent(id)}&submit=delete+selected`, { cookie });
        assertHttpOk(response, '删除 TXT');
        this.subdomainHtml = '';
        const after = await this.loadSubdomainPage(true);
        if (this.findTxtDataIds(fulldomain, after).includes(id)) {
          throw integrationError('FreeDNS 未能删除 TXT 验证记录', 502);
        }
        return;
      }
    });
  }

  async deleteRecord(id) {
    if (!id) return;
    await this.runAuthenticated(async (cookie) => {
      const { response } = await this.request(`/subdomain/delete2.php?data_id%5B%5D=${encodeURIComponent(id)}&submit=delete+selected`, { cookie });
      assertHttpOk(response, '删除 TXT');
      this.subdomainHtml = '';
    });
  }
}
