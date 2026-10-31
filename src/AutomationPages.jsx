import { UISelect } from './UISelect.jsx';
import { IssuanceLog } from './IssuanceLog.jsx';
import { Dialog } from '@base-ui/react/dialog';
import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { AliyunZoneField } from './AliyunZoneField.jsx';

export const emptyDdns = {
  version: 2, intervalSeconds: 300, cacheTimes: 1,
  webhook: { enabled: false, url: '', requestBody: '', headers: '' },
  tasks: [], logs: [],
  provider: 'cloudflare', zoneId: '', hasApiToken: false, enabled: false, recordName: '', recordType: 'A', ttl: 1, proxied: false, intervalMinutes: 5,
  aliyun: { accessKeyId: '', hasAccessKeySecret: false, dnsZone: '', line: 'default' },
  dnspod: { secretId: '', hasSecretKey: false, dnsZone: '', line: '默认' },
};
const ddnsProviders = {
  cloudflare: 'Cloudflare', aliyun: '阿里云 DNS', aliyun_esa: '阿里云 ESA', tencentcloud: '腾讯云 DNS', dnspod: 'DNSPod',
  huaweicloud: '华为云', baiducloud: '百度云', porkbun: 'Porkbun', godaddy: 'GoDaddy', namecheap: 'Namecheap',
  namesilo: 'NameSilo', dynadot: 'Dynadot', dnsla: 'DNSLA', nowcn: '时代互联', eranet: 'Eranet', tnethk: 'Tnethk',
  gcore: 'Gcore', edgeone: 'EdgeOne', nsone: 'IBM NS1 Connect', rainyun: '雨云', desec: 'deSEC', callback: 'Callback',
};
const emptyStack = (type = 'A') => ({
  enabled: type === 'A', getType: 'url',
  urls: type === 'AAAA'
    ? ['https://api6.ipify.org?format=json', 'https://ipv6.icanhazip.com', 'https://v6.ident.me']
    : ['https://ddns.oray.com/checkip', 'https://ip.3322.net', 'https://myip.ipip.net', 'https://api.ipify.org?format=json'],
  netInterface: '', command: '', domains: [],
});
const emptyTask = () => ({
  id: '', name: '新任务', enabled: false, provider: 'cloudflare', ttl: 1, customParams: '',
  credentials: { zoneId: '', apiToken: '', proxied: false },
  ipv4: emptyStack('A'), ipv6: { ...emptyStack('AAAA'), enabled: false },
});
export const emptyIssuance = {
  provider: 'aliyun-free', running: [],
  acme: {
    dnsProvider: 'cloudflare', zoneId: '', hasApiToken: false, freednsUsername: '', hasFreednsPassword: false, hasFreednsSession: false,
    eabKid: '', hasEabHmacKey: false, email: '', domains: [], environment: 'staging', autoRenew: false, renewDays: 30, phase: 'idle',
  },
  aliyun: { apiVersion: 'v2', contactId: '', accessKeyId: '', hasAccessKeySecret: false, domain: '', dnsZone: '', username: '', phone: '', email: '', autoRenew: false, renewDays: 15, phase: 'idle', quota: null, order: null },
};
const acmeDnsProviders = { cloudflare: 'Cloudflare', freedns: 'FreeDNS' };
const moment = (value) => value ? new Date(value).toLocaleString() : '尚未运行';
const date = (value) => value ? new Date(value).toLocaleDateString() : '尚未签发';
const Icon = ({ name }) => <i className={`bi ${name}`} aria-hidden="true" />;
export function Field({ label, hint, children, required = false }) {
  const id = useId();
  return <div className="form-field"><label className="field-label" htmlFor={id}>{label}{required ? <b aria-hidden="true">*</b> : null}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined, 'aria-required': required })}{hint ? <small id={`${id}-hint`}>{hint}</small> : null}</div>;
}
export function Check({ checked, onChange, title, description }) {
  return <label className="check-row"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} /><span><strong>{title}</strong><small>{description}</small></span></label>;
}
function Chip({ tone = 'disabled', children }) { return <span className={`state-chip ${tone}`}><Icon name={tone === 'healthy' ? 'bi-check-circle-fill' : tone === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-circle'} />{children}</span>; }
export function Notice({ children, error = false, focusRef }) { return <aside ref={focusRef} tabIndex={focusRef ? -1 : undefined} className={`automation-notice${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'bi-exclamation-triangle' : 'bi-info-circle'} /><span>{children}</span></aside>; }
function Editor({ open, title, description, busy, onClose, onSubmit, children, error, lookupBusy = false }) {
  const errorRef = useRef(null);
  useEffect(() => { if (open && error) { errorRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); errorRef.current?.focus({ preventScroll: true }); } }, [open, error]);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop" /><Dialog.Popup className="dialog-popup automation-editor"><form onSubmit={onSubmit}><header className="dialog-header"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭设置" disabled={busy}><Icon name="bi-x-lg" /></Dialog.Close></header><div className="dialog-body automation-form">{error ? <Notice error focusRef={errorRef}>{error}</Notice> : null}<fieldset className="automation-fields" disabled={busy}>{children}</fieldset></div><footer className="dialog-actions"><Dialog.Close className="secondary-button" disabled={busy}>取消</Dialog.Close><button type="submit" className="primary-button" disabled={busy || lookupBusy}><Icon name={busy ? 'bi-arrow-repeat' : 'bi-floppy'} />{busy ? '正在保存…' : '保存设置'}</button></footer></form></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
function CloudflareFields({ draft, set }) {
  return <div className="form-grid two"><Field label="Cloudflare Zone ID" hint="域名概览右侧 Zone ID；不要填账户页的 Account ID"><input value={draft.zoneId} autoComplete="off" onChange={(event) => set('zoneId', event.target.value)} placeholder="32 位十六进制 Zone ID" /></Field><Field label="API Token" hint={draft.hasApiToken ? '已保存，留空保留；不会回显' : '仅授予目标 Zone 的 DNS 编辑权限'}><input type="password" autoComplete="new-password" value={draft.apiToken || ''} onChange={(event) => set('apiToken', event.target.value)} placeholder={draft.hasApiToken ? '已保存（留空保留）' : 'Cloudflare API Token'} /></Field></div>;
}

function FreeDnsFields({ draft, set }) {
  return <>
    <div className="form-grid two">
      <Field label="FreeDNS 用户名"><input value={draft.freednsUsername} autoComplete="username" onChange={(event) => set('freednsUsername', event.target.value)} placeholder="afraid.org 登录用户名" /></Field>
      <Field label="FreeDNS 密码" hint={draft.hasFreednsPassword ? '已保存，留空保留；不会回显' : '用于写入 TXT 验证记录'}><input type="password" autoComplete="new-password" value={draft.freednsPassword || ''} onChange={(event) => set('freednsPassword', event.target.value)} placeholder={draft.hasFreednsPassword ? '已保存（留空保留）' : '登录密码'} /></Field>
    </div>
    {draft.hasFreednsPassword ? <Check checked={draft.clearFreednsPassword} onChange={(value) => set('clearFreednsPassword', value)} title="清除已保存的 FreeDNS 密码" description="下次签发需重新填写密码。" /> : null}
    {draft.hasFreednsSession ? <Check checked={draft.clearFreednsSessionCookie} onChange={(value) => set('clearFreednsSessionCookie', value)} title="清除已保存的 FreeDNS 会话" description="会话过期或签发失败时可清除，下次将使用密码重新登录。" /> : null}
    <p className="automation-caption">FreeDNS 通过网页会话写入 TXT 记录；公共共享域若要求安全码则无法自动验证。UserID 与密码须与 afraid.org 网页登录完全一致；修改 UserID 或遇 FREEDNS_AUTH_INVALID 时请在密码框重新输入密码并保存（留空不会更新已保存密码）。凭据仅用于证书签发，与 DDNS 独立。</p>
  </>;
}

function AcmeDnsFields({ draft, set }) {
  return <>
    <Field label="DNS-01 服务商" hint="与 DDNS 凭据独立，仅用于证书验证。"><UISelect value={draft.dnsProvider} onChange={(event) => set('dnsProvider', event.target.value)}>{Object.entries(acmeDnsProviders).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UISelect></Field>
    {draft.dnsProvider === 'freedns' ? <FreeDnsFields draft={draft} set={set} /> : <CloudflareFields draft={draft} set={set} />}
  </>;
}

function DdnsCloudFields({ provider, draft, set, recordName, savedAccessKeyId, active, locked, onLookupBusy }) {
  const isAliyun = provider === 'aliyun';
  const idKey = isAliyun ? 'accessKeyId' : 'secretId';
  const secretKey = isAliyun ? 'accessKeySecret' : 'secretKey';
  const hasSecret = isAliyun ? draft.hasAccessKeySecret : draft.hasSecretKey;
  const clearKey = isAliyun ? 'clearAccessKeySecret' : 'clearSecretKey';
  return <>
    <div className="form-grid two">
      <Field label={isAliyun ? 'AccessKey ID' : 'SecretId'}><input value={draft[idKey]} autoComplete="off" onChange={(event) => set(idKey, event.target.value)} placeholder={isAliyun ? 'RAM 用户 AccessKey ID' : '腾讯云 API 密钥 SecretId'} /></Field>
      <Field label={isAliyun ? 'AccessKey Secret' : 'SecretKey'} hint={hasSecret ? '已保存，留空保留；不会回显' : '仅保存在本机，不进入导出与诊断包'}><input type="password" value={draft[secretKey] || ''} autoComplete="new-password" onChange={(event) => set(secretKey, event.target.value)} placeholder={hasSecret ? '已保存（留空保留）' : isAliyun ? 'RAM 用户 AccessKey Secret' : '腾讯云 API 密钥 SecretKey'} /></Field>
      {isAliyun ? <AliyunZoneField value={draft.dnsZone} onChange={(value) => set('dnsZone', value)} domain={recordName} credentials={draft} savedAccessKeyId={savedAccessKeyId} scope="ddns" active={active} locked={locked} onBusy={onLookupBusy} /> : <Field label="DNS 主域名" hint="服务商控制台中管理的解析区域"><input value={draft.dnsZone} onChange={(event) => set('dnsZone', event.target.value)} placeholder="example.com" /></Field>}
    </div>
    {hasSecret ? <Check checked={draft[clearKey]} onChange={(value) => set(clearKey, value)} title="清除已保存的 DDNS 密钥" description="仅清除当前服务商的 DDNS 密钥。" /> : null}
    <details className="automation-details"><summary>解析线路与权限</summary>
      <Field label="解析线路" hint={isAliyun ? '填写阿里云线路代码，通常为 default' : '填写 DNSPod 线路名称，通常为「默认」'}><input value={draft.line} onChange={(event) => set('line', event.target.value)} /></Field>
      <p>仅需目标解析区域的查询、添加、修改记录权限，无需删除权限。{isAliyun ? '与证书签发使用独立凭据。' : '使用腾讯云 SecretId / SecretKey，不是旧版 DNSPod Token。'}<a href={isAliyun ? 'https://help.aliyun.com/zh/dns/api-alidns-2015-01-09-overview' : 'https://cloud.tencent.com/document/product/1427/56194'} target="_blank" rel="noreferrer">查看接口说明</a></p>
      {isAliyun ? <p>自动识别另需 <code>alidns:DescribeDomains</code> 查询权限；不授予该权限时仍可手动填写。</p> : null}
    </details>
  </>;
}

function StackFields({ label, stack, onChange }) {
  const set = (key, value) => onChange({ ...stack, [key]: value });
  return <section className="form-card">
    <Check checked={stack.enabled} onChange={(value) => set('enabled', value)} title={`启用 ${label}`} description={`同步时更新 ${label} 域名列表。`} />
    {stack.enabled ? <>
      <Field label="取 IP 方式"><UISelect value={stack.getType} onChange={(event) => set('getType', event.target.value)}><option value="url">接口</option><option value="netInterface">网卡</option><option value="command">命令</option></UISelect></Field>
      {stack.getType === 'url' ? <Field label="IP 接口（每行一个）" hint="默认含花生壳/3322/ipip/ipify 等，失败时依次尝试"><textarea rows="3" value={(stack.urls || []).join('\n')} onChange={(event) => set('urls', event.target.value.split(/\n+/))} /></Field> : null}
      {stack.getType === 'netInterface' ? <Field label="网卡名或 /正则/" hint="例如 eth0 或 /en.*/"><input value={stack.netInterface} onChange={(event) => set('netInterface', event.target.value)} /></Field> : null}
      {stack.getType === 'command' ? <Field label="取 IP 命令" hint="在 NAS 上执行，解析 stdout 中的首个公网地址；请谨慎使用"><input value={stack.command} onChange={(event) => set('command', event.target.value)} placeholder="curl -4 -s ifconfig.me" /></Field> : null}
      <Field label="域名列表（每行一个）"><textarea rows="3" value={(stack.domains || []).join('\n')} onChange={(event) => set('domains', event.target.value.split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean))} placeholder={'home.example.com\nvpn.example.com'} /></Field>
    </> : null}
  </section>;
}

function TaskCredentialFields({ provider, credentials, setCredentials, recordHint, savedAccessKeyId, active, locked, onLookupBusy }) {
  const c = credentials || {};
  const set = (key, value) => setCredentials({ ...c, [key]: value });
  if (provider === 'cloudflare') {
    return <>
      <div className="form-grid two">
        <Field label="Cloudflare Zone ID"><input value={c.zoneId || ''} onChange={(event) => set('zoneId', event.target.value)} placeholder="32 位 Zone ID" /></Field>
        <Field label="API Token" hint={c.hasApiToken ? '已保存，留空保留' : 'DNS 编辑权限'}><input type="password" value={c.apiToken || ''} onChange={(event) => set('apiToken', event.target.value)} placeholder={c.hasApiToken ? '已保存（留空保留）' : 'API Token'} /></Field>
      </div>
      <Check checked={c.proxied} onChange={(value) => set('proxied', value)} title="启用 Cloudflare 代理" description="仅适用于 Cloudflare 支持代理的 Web 端口。" />
      {c.hasApiToken ? <Check checked={c.clearApiToken} onChange={(value) => set('clearApiToken', value)} title="清除已保存的令牌" description="仅清除本任务凭据。" /> : null}
    </>;
  }
  if (provider === 'callback' || provider === 'edgeone') {
    return <>
      <Field label="Callback URL" hint="可使用 #{ip} #{domain} #{recordType} #{ttl}"><input value={c.url || ''} onChange={(event) => set('url', event.target.value)} placeholder="https://example.com/ddns?ip=#{ip}" /></Field>
      <Field label="Request Body（可选，非空则 POST）"><textarea rows="3" value={c.requestBody || ''} onChange={(event) => set('requestBody', event.target.value)} /></Field>
      <Field label="Headers（每行 Key: Value）"><textarea rows="2" value={c.headers || ''} onChange={(event) => set('headers', event.target.value)} /></Field>
    </>;
  }
  if (provider === 'aliyun' || provider === 'aliyun_esa') {
    return <DdnsCloudFields provider="aliyun" draft={{ ...c, hasAccessKeySecret: c.hasAccessKeySecret }} set={(key, value) => set(key, value)} recordName={recordHint} savedAccessKeyId={savedAccessKeyId} active={active} locked={locked} onLookupBusy={onLookupBusy} />;
  }
  if (provider === 'tencentcloud' || provider === 'dnspod') {
    return <DdnsCloudFields provider="dnspod" draft={{ accessKeyId: c.secretId, secretId: c.secretId, secretKey: c.secretKey, hasSecretKey: c.hasSecretKey, dnsZone: c.dnsZone, line: c.line || '默认', clearSecretKey: c.clearSecretKey }} set={(key, value) => set(key === 'accessKeyId' ? 'secretId' : key, value)} recordName={recordHint} savedAccessKeyId="" active={active} locked={locked} onLookupBusy={onLookupBusy} />;
  }
  if (provider === 'namecheap') {
    return <div className="form-grid two"><Field label="主域名"><input value={c.dnsZone || ''} onChange={(event) => set('dnsZone', event.target.value)} /></Field><Field label="Dynamic DNS Password" hint={c.hasPassword ? '已保存，留空保留' : ''}><input type="password" value={c.password || ''} onChange={(event) => set('password', event.target.value)} /></Field></div>;
  }
  if (['desec', 'nsone', 'gcore', 'rainyun'].includes(provider)) {
    const key = provider === 'desec' ? 'token' : 'apiKey';
    const has = c[`has${key[0].toUpperCase()}${key.slice(1)}`];
    return <div className="form-grid two"><Field label="主域名"><input value={c.dnsZone || ''} onChange={(event) => set('dnsZone', event.target.value)} /></Field><Field label={provider === 'desec' ? 'Token' : 'API Key'} hint={has ? '已保存，留空保留' : ''}><input type="password" value={c[key] || ''} onChange={(event) => set(key, event.target.value)} /></Field></div>;
  }
  if (provider === 'huaweicloud') {
    return <div className="form-grid two">
      <Field label="项目 ID"><input value={c.id || ''} onChange={(event) => set('id', event.target.value)} /></Field>
      <Field label="Token" hint={c.hasSecret ? '已保存，留空保留' : ''}><input type="password" value={c.secret || ''} onChange={(event) => set('secret', event.target.value)} /></Field>
      <Field label="Zone ID"><input value={c.dnsZone || ''} onChange={(event) => set('dnsZone', event.target.value)} /></Field>
    </div>;
  }
  if (provider === 'baiducloud') {
    return <div className="form-grid two">
      <Field label="Access Key ID"><input value={c.accessKeyId || ''} onChange={(event) => set('accessKeyId', event.target.value)} /></Field>
      <Field label="Access Key Secret" hint={c.hasAccessKeySecret ? '已保存，留空保留' : ''}><input type="password" value={c.accessKeySecret || ''} onChange={(event) => set('accessKeySecret', event.target.value)} /></Field>
      <Field label="主域名"><input value={c.dnsZone || ''} onChange={(event) => set('dnsZone', event.target.value)} /></Field>
    </div>;
  }
  return <div className="form-grid two">
    <Field label="ID / API Key"><input value={c.id || ''} onChange={(event) => set('id', event.target.value)} /></Field>
    <Field label="Secret" hint={c.hasSecret ? '已保存，留空保留' : ''}><input type="password" value={c.secret || ''} onChange={(event) => set('secret', event.target.value)} /></Field>
    <Field label="主域名（如需要）"><input value={c.dnsZone || ''} onChange={(event) => set('dnsZone', event.target.value)} /></Field>
  </div>;
}

export function DdnsPage({ integration, busy, detectBusy, onDetect, onSave, onSync, onTest, onLoadInterfaces }) {
  const status = { ...emptyDdns, ...integration, webhook: { ...emptyDdns.webhook, ...integration?.webhook }, tasks: Array.isArray(integration?.tasks) ? integration.tasks : [], logs: integration?.logs || [] };
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftTask, setDraftTask] = useState(emptyTask());
  const [globalDraft, setGlobalDraft] = useState({ intervalSeconds: status.intervalSeconds, cacheTimes: status.cacheTimes, webhook: status.webhook });
  const [error, setError] = useState('');
  const [detectType, setDetectType] = useState('A');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [interfaces, setInterfaces] = useState([]);
  const detection = status.detection?.results?.[detectType];
  const tasks = status.tasks || [];
  useEffect(() => { if (open) setError(''); }, [open]);
  useEffect(() => { if (settingsOpen) setGlobalDraft({ intervalSeconds: status.intervalSeconds, cacheTimes: status.cacheTimes, webhook: { ...status.webhook } }); }, [settingsOpen]);

  const openTask = (task) => {
    const next = task ? {
      ...emptyTask(), ...task,
      credentials: { ...(task.credentials || {}), apiToken: '', accessKeySecret: '', secretKey: '', secret: '', password: '', token: '', apiKey: '' },
      ipv4: { ...emptyStack('A'), ...task.ipv4 },
      ipv6: { ...emptyStack('AAAA'), ...task.ipv6 },
    } : emptyTask();
    setDraftTask(next);
    setOpen(true);
    if (onLoadInterfaces) void onLoadInterfaces().then((items) => setInterfaces(items || [])).catch(() => setInterfaces([]));
  };

  const saveTask = async (event) => {
    event.preventDefault();
    const nextTasks = draftTask.id
      ? tasks.map((task) => (task.id === draftTask.id ? draftTask : task))
      : [...tasks, draftTask];
    const result = await onSave({
      intervalSeconds: status.intervalSeconds,
      cacheTimes: status.cacheTimes,
      webhook: status.webhook,
      tasks: nextTasks,
    });
    if (result === true) setOpen(false);
    else setError(result?.error?.message || '保存失败，请检查填写内容');
  };

  const saveGlobal = async (event) => {
    event.preventDefault();
    const result = await onSave({ intervalSeconds: globalDraft.intervalSeconds, cacheTimes: globalDraft.cacheTimes, webhook: globalDraft.webhook });
    if (result === true) setSettingsOpen(false);
    else setError(result?.error?.message || '保存失败');
  };

  const removeTask = async (taskId) => {
    if (!window.confirm('删除该 DDNS 任务？')) return;
    const result = await onSave({ intervalSeconds: status.intervalSeconds, cacheTimes: status.cacheTimes, webhook: status.webhook, tasks: tasks.filter((task) => task.id !== taskId) });
    if (result !== true) setError(result?.error?.message || '删除失败');
  };

  const recordHint = [...(draftTask.ipv4?.domains || []), ...(draftTask.ipv6?.domains || [])][0] || '';

  return <section className="view automation-page" aria-label="DDNS 同步">
    <article className="matte-surface certificate-surface">
      <div className="section-heading"><div><h2>自动获取公网 IP</h2><p>支持接口、网卡或命令；也可在任务中分别配置 IPv4 / IPv6。</p></div><span className="state-chip disabled">只读检测</span></div>
      <div className="ip-detection-controls"><Field label="检测地址类型"><UISelect value={detectType} disabled={detectBusy} onChange={(event) => setDetectType(event.target.value)}><option value="A">IPv4 · A 记录</option><option value="AAAA">IPv6 · AAAA 记录</option></UISelect></Field><button className="secondary-button" disabled={detectBusy} onClick={() => onDetect(detectType)}><Icon name={detectBusy ? 'bi-arrow-repeat' : 'bi-crosshair'} />{detectBusy ? '正在检测…' : `检测公网 IPv${detectType === 'A' ? '4' : '6'}`}</button></div>
      <dl className="automation-facts" aria-live="polite"><div><dt>检测到的公网地址</dt><dd className="ip-address">{detection?.ip || (status.demoMode ? '演示模式 · 不读取真实 IP' : '点击检测后显示')}</dd></div><div><dt>检测来源</dt><dd>{detection?.source || '—'}</dd></div><div><dt>检测时间</dt><dd>{detection?.detectedAt ? moment(detection.detectedAt) : '尚未检测'}</dd></div></dl>
      {detection?.error ? <Notice error>{detection.error}</Notice> : null}
      <p className="automation-caption">全局每 {Math.round((status.intervalSeconds || 300) / 60)} 分钟同步；本地 IP 连续命中 {status.cacheTimes || 1} 次后再比对云端。此处检测不会修改 DNS。</p>
    </article>

    <article className="matte-surface certificate-surface">
      <div className="section-heading"><div><h2>DDNS 任务</h2><p>可同时配置多个服务商与多组域名，对齐 DDNS-Go。</p></div><div className="automation-actions"><button className="secondary-button" disabled={busy} onClick={() => setSettingsOpen(true)}><Icon name="bi-sliders" />全局设置</button><button className="primary-button" disabled={busy} onClick={() => openTask(null)}><Icon name="bi-plus-lg" />新建任务</button></div></div>
      {!tasks.length ? <Notice>尚未配置任务。点击「新建任务」开始。</Notice> : tasks.map((task) => {
        const domains = [...(task.ipv4?.enabled ? task.ipv4.domains : []), ...(task.ipv6?.enabled ? task.ipv6.domains : [])];
        return <div key={task.id} className="automation-domain" style={{ marginBottom: '0.75rem' }}>
          <span className="automation-service-icon"><Icon name="bi-broadcast-pin" /></span>
          <div><strong>{task.name || domains[0] || '未命名任务'}</strong><small>{ddnsProviders[task.provider] || task.provider} · {domains.join('、') || '未配置域名'}{task.ipv4?.enabled ? ' · IPv4' : ''}{task.ipv6?.enabled ? ' · IPv6' : ''}</small></div>
          <Chip tone={task.lastError ? 'warning' : task.enabled ? 'healthy' : 'disabled'}>{task.lastError ? '同步异常' : task.enabled ? '自动同步' : '手动'}</Chip>
          <div className="automation-actions">
            <button className="secondary-button" disabled={busy} onClick={() => onSync(task.id)}>同步</button>
            <button className="secondary-button" disabled={busy} onClick={() => onTest(task.id)}>测试</button>
            <button className="secondary-button" disabled={busy} onClick={() => openTask(task)}>编辑</button>
            <button className="secondary-button" disabled={busy} onClick={() => void removeTask(task.id)}>删除</button>
          </div>
        </div>;
      })}
      {status.demoMode ? <Notice>本地演示模式，不会读取公网地址或修改 DNS。</Notice> : null}
      <div className="automation-actions"><button className="primary-button" disabled={busy || !tasks.length} onClick={() => onSync()}><Icon name={busy ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'} />{busy ? '正在处理…' : '同步全部启用任务'}</button></div>
    </article>

    <article className="matte-surface certificate-surface">
      <div className="section-heading"><div><h2>最近日志</h2><p>最多保留 50 条。</p></div></div>
      {!status.logs?.length ? <p className="automation-caption">暂无日志</p> : <ul className="automation-caption">{status.logs.slice().reverse().map((item, index) => <li key={`${item.at}-${index}`}>[{moment(item.at)}] {item.level}: {item.message}</li>)}</ul>}
    </article>

    <Editor open={open} title={draftTask.id ? '编辑 DDNS 任务' : '新建 DDNS 任务'} description="每个任务可独立选择服务商、双栈取 IP 与域名列表。" busy={busy} lookupBusy={lookupBusy} onClose={() => setOpen(false)} onSubmit={saveTask} error={error}>
      <section className="form-card">
        <div className="form-grid two">
          <Field label="任务名称"><input value={draftTask.name} onChange={(event) => setDraftTask((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="DNS 服务商"><UISelect value={draftTask.provider} onChange={(event) => setDraftTask((current) => ({ ...current, provider: event.target.value, enabled: false, ttl: event.target.value !== 'cloudflare' && Number(current.ttl) === 1 ? 600 : current.ttl, credentials: {} }))}>{Object.entries(ddnsProviders).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UISelect></Field>
          <Field label="TTL（秒）"><input type="number" min={draftTask.provider === 'cloudflare' ? 1 : 60} max="86400" value={draftTask.ttl} onChange={(event) => setDraftTask((current) => ({ ...current, ttl: event.target.value }))} /></Field>
        </div>
        <Check checked={draftTask.enabled} onChange={(value) => setDraftTask((current) => ({ ...current, enabled: value }))} title="启用定时同步" description="参与全局调度。" />
        <TaskCredentialFields provider={draftTask.provider} credentials={draftTask.credentials} setCredentials={(credentials) => setDraftTask((current) => ({ ...current, credentials }))} recordHint={recordHint} savedAccessKeyId={draftTask.credentials?.accessKeyId} active={open} locked={busy} onLookupBusy={setLookupBusy} />
        <Field label="自定义参数" hint="部分服务商扩展参数；阿里云 ESA 可填 customUrl 模板"><input value={draftTask.customParams || ''} onChange={(event) => setDraftTask((current) => ({ ...current, customParams: event.target.value }))} /></Field>
        {interfaces.length ? <p className="automation-caption">当前网卡：{interfaces.map((item) => `${item.name}=${item.address}`).join(' · ')}</p> : null}
      </section>
      <StackFields label="IPv4" stack={draftTask.ipv4} onChange={(ipv4) => setDraftTask((current) => ({ ...current, ipv4 }))} />
      <StackFields label="IPv6" stack={draftTask.ipv6} onChange={(ipv6) => setDraftTask((current) => ({ ...current, ipv6 }))} />
    </Editor>

    <Editor open={settingsOpen} title="DDNS 全局设置" description="同步间隔、缓存次数与 Webhook。" busy={busy} onClose={() => setSettingsOpen(false)} onSubmit={saveGlobal} error={error}>
      <section className="form-card">
        <div className="form-grid two">
          <Field label="同步间隔（秒）" hint="默认 300，对齐 DDNS-Go 约 5 分钟"><input type="number" min="10" max="86400" value={globalDraft.intervalSeconds} onChange={(event) => setGlobalDraft((current) => ({ ...current, intervalSeconds: event.target.value }))} /></Field>
          <Field label="缓存次数" hint="本地 IP 连续相同 N 次后再比对云端"><input type="number" min="1" max="3600" value={globalDraft.cacheTimes} onChange={(event) => setGlobalDraft((current) => ({ ...current, cacheTimes: event.target.value }))} /></Field>
        </div>
        <Check checked={globalDraft.webhook?.enabled} onChange={(value) => setGlobalDraft((current) => ({ ...current, webhook: { ...current.webhook, enabled: value } }))} title="启用 Webhook" description="同步结束后回调；变量与 DDNS-Go 一致。" />
        <Field label="Webhook URL"><input value={globalDraft.webhook?.url || ''} onChange={(event) => setGlobalDraft((current) => ({ ...current, webhook: { ...current.webhook, url: event.target.value } }))} placeholder="https://example.com/hook?ip=#{ipv4Addr}" /></Field>
        <Field label="Request Body（可选）"><textarea rows="4" value={globalDraft.webhook?.requestBody || ''} onChange={(event) => setGlobalDraft((current) => ({ ...current, webhook: { ...current.webhook, requestBody: event.target.value } }))} /></Field>
        <Field label="Headers（每行 Key: Value）"><textarea rows="2" value={globalDraft.webhook?.headers || ''} onChange={(event) => setGlobalDraft((current) => ({ ...current, webhook: { ...current.webhook, headers: event.target.value } }))} /></Field>
      </section>
    </Editor>
  </section>;
}

const phases = { idle: '待配置 / 待签发', checking: '检查免费额度', creating: '提交申请', uncertain: '需要核对订单', pending: '等待订单信息', domain_verify: 'DNS 验证中', process: 'CA 审核中', verify_fail: '审核未通过', payed: '需要在云端提交申请', unknown: '等待云端状态', cleanup: '清理验证记录', issued: '已签发', issuing: '正在签发', error: '上次操作失败' };
function IssuanceEditor({ open, provider, integration, busy, onClose, onSave, expectedDomains = [] }) {
  const isAliyun = provider === 'aliyun-free';
  const isZeroSsl = provider === 'zerossl';
  const config = isAliyun ? integration.aliyun : integration.acme;
  const [lookupBusy, setLookupBusy] = useState(false);
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setDraft({ ...config, accessKeySecret: '', apiToken: '', freednsPassword: '', eabHmacKey: '', clearFreednsPassword: false, clearFreednsSessionCookie: false, domainsText: (expectedDomains.length ? expectedDomains : config.domains || []).join('\n'), ...(isAliyun && expectedDomains.length && !config.order ? { domain: expectedDomains[0], dnsZone: config.domain === expectedDomains[0] ? config.dnsZone : '' } : {}) }); setError(''); } }, [open]);
  const set = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setError(''); };
  const save = async (event) => {
    event.preventDefault();
    const payload = isAliyun ? { aliyun: Object.fromEntries(['apiVersion', 'contactId', 'accessKeyId', 'accessKeySecret', 'domain', 'dnsZone', 'username', 'phone', 'email', 'autoRenew', 'renewDays'].map((key) => [key, draft[key]])) } : { acme: { ...draft, domains: draft.domainsText.split(/[,，;；\s]+/).map((item) => item.trim()).filter(Boolean) } };
    const result = await onSave(payload);
    if (result === true) onClose(); else setError(result?.error?.message || '保存失败，请检查填写内容');
  };
  const acmeDescription = draft.dnsProvider === 'freedns' ? '使用 FreeDNS 账户完成 DNS-01 验证。' : '使用独立的 Cloudflare 凭据完成 DNS-01 验证。';
  return <Editor open={open} title={isAliyun ? '阿里云免费证书设置' : isZeroSsl ? 'ZeroSSL 签发设置' : 'Let’s Encrypt 签发设置'} description={isAliyun ? '只需 AccessKey 和证书域名，DNS 主域名自动识别。' : isZeroSsl ? `${acmeDescription} 需在 ZeroSSL 控制台创建 EAB 凭据。` : acmeDescription} busy={busy} lookupBusy={lookupBusy} onClose={onClose} onSubmit={save} error={error}>
    {expectedDomains.length && config.certificateId ? <Notice>此服务目前使用一组签发域名。保存不同域名会调整后续自动轮换范围；原证书及其代理规则保持不变。</Notice> : null}
    <section className="form-card">{isAliyun ? <><Field label="阿里云证书版本" hint="切换版本会暂停自动轮换，正在处理的申请不允许切换。"><UISelect value={draft.apiVersion} disabled={Boolean(config.order)} onChange={(event) => { set('apiVersion', event.target.value); set('autoRenew', false); }}><option value="v2">新版 V2.0 · 已领取实例</option><option value="v1">旧版 V1.0 · 历史资源包</option></UISelect></Field><div className="form-grid two"><Field label="AccessKey ID"><input value={draft.accessKeyId} autoComplete="off" disabled={Boolean(config.order)} onChange={(event) => set('accessKeyId', event.target.value)} placeholder="RAM 用户 AccessKey ID" /></Field><Field label="AccessKey Secret" hint={draft.hasAccessKeySecret ? '已保存，留空保留；不会回显' : '仅保存在本机，不进入导出与诊断包'}><input type="password" autoComplete="new-password" value={draft.accessKeySecret} onChange={(event) => set('accessKeySecret', event.target.value)} placeholder={draft.hasAccessKeySecret ? '已保存（留空保留）' : 'RAM 用户 AccessKey Secret'} /></Field><Field label="证书域名" hint="免费套餐仅支持单个域名"><input value={draft.domain} disabled={Boolean(config.order)} onChange={(event) => set('domain', event.target.value)} placeholder="home.example.com" /></Field><AliyunZoneField value={draft.dnsZone} onChange={(value) => set('dnsZone', value)} domain={draft.domain} credentials={draft} savedAccessKeyId={config.accessKeyId} scope="certificate-issuance" active={open} locked={busy || Boolean(config.order)} onBusy={setLookupBusy} /></div>{config.order ? <Notice>订单处理期间锁定域名与账号；仍可更新 Secret 或关闭自动轮换。</Notice> : null}<details className="automation-details"><summary>联系人与权限说明</summary>{draft.apiVersion === 'v2' ? <Field label="联系人 ID（可选）" hint="优先复用实例联系人；账号只有一个联系人时自动使用。"><input inputMode="numeric" value={draft.contactId || ''} onChange={(event) => set('contactId', event.target.value)} /></Field> : <><p>可选：仅在云端提示缺少联系人时填写。</p><div className="form-grid two"><Field label="联系人姓名"><input value={draft.username} onChange={(event) => set('username', event.target.value)} autoComplete="name" /></Field><Field label="手机号码"><input type="tel" value={draft.phone} onChange={(event) => set('phone', event.target.value)} autoComplete="tel" /></Field><Field label="联系邮箱"><input type="email" value={draft.email} onChange={(event) => set('email', event.target.value)} autoComplete="email" /></Field></div></>}<p>RAM 需允许新版实例列表/详情、更新实例、申请、任务查询、下载证书与联系人查询；旧版需要证书额度查询、申请、订单查询，以及目标 DNS 区域的查询、添加和删除记录。自动识别另需 alidns:DescribeDomains 查询权限；也可手动填写主域名。<a href={draft.apiVersion === 'v2' ? 'https://help.aliyun.com/zh/ssl-certificate/product-overview/announcement-ssl-certificate-v2-0-api-interface-release-notes' : 'https://help.aliyun.com/zh/ssl-certificate/developer-reference/api-cas-2020-04-07-createcertificateforpackagerequest'} target="_blank" rel="noreferrer">查看接口权限</a></p></details></> : <><AcmeDnsFields draft={draft} set={set} />{isZeroSsl ? <div className="form-grid two"><Field label="EAB KID" hint="ZeroSSL 控制台 → Developer → EAB Credentials"><input value={draft.eabKid} autoComplete="off" onChange={(event) => set('eabKid', event.target.value)} placeholder="KID" /></Field><Field label="EAB HMAC Key" hint={draft.hasEabHmacKey ? '已保存，留空保留；不会回显' : '与 KID 成对创建'}><input type="password" autoComplete="new-password" value={draft.eabHmacKey || ''} onChange={(event) => set('eabHmacKey', event.target.value)} placeholder={draft.hasEabHmacKey ? '已保存（留空保留）' : 'HMAC Key'} /></Field></div> : null}<div className="form-grid two"><Field label="联系邮箱"><input type="email" value={draft.email} onChange={(event) => set('email', event.target.value)} placeholder="admin@example.com" /></Field>{!isZeroSsl ? <Field label="签发环境"><UISelect value={draft.environment} onChange={(event) => set('environment', event.target.value)}><option value="staging">测试环境 · 不受浏览器信任</option><option value="production">正式环境 · 受签发限额约束</option></UISelect></Field> : null}</div><Field label="证书域名" hint="逗号、空格或换行分隔，支持通配符"><textarea rows="3" value={draft.domainsText} onChange={(event) => set('domainsText', event.target.value)} placeholder={'example.com\n*.example.com'} /></Field>{!isZeroSsl ? <Notice>测试证书独立保存，不会覆盖正在使用的正式证书。</Notice> : <Notice>ZeroSSL 仅提供正式签发目录，请确认域名与 DNS 凭据正确。</Notice>}</>}</section>
    <section className="form-card"><Check checked={draft.autoRenew} onChange={(value) => set('autoRenew', value)} title="到期前自动轮换" description="先签发新证书，成功后保留原 ID 和规则绑定并热更新；失败保留旧证书。" /><details className="automation-details"><summary>高级轮换设置</summary><Field label="提前轮换（天）" hint={isAliyun ? '7–30 天，默认提前 15 天' : '7–60 天，默认提前 30 天'}><input type="number" min="7" max={isAliyun ? 30 : 60} value={draft.renewDays} onChange={(event) => set('renewDays', event.target.value)} /></Field></details>{isAliyun ? <Notice>每次重新签发使用免费额度；额度不足时停止申请，不会购买付费证书。</Notice> : null}</section>
  </Editor>;
}

export function IssuancePage({ integration, certificates, busy, onSave, onIssue, onQuota, onAssociate, onRetry, onReset, onCertificates, onRefresh, expectedDomains = [] }) {
  const status = { ...emptyIssuance, ...integration, acme: { ...emptyIssuance.acme, ...integration?.acme }, aliyun: { ...emptyIssuance.aliyun, ...integration?.aliyun } };
  const isAliyun = status.provider === 'aliyun-free';
  const isZeroSsl = status.provider === 'zerossl';
  const isAcmeCa = status.provider === 'acme' || isZeroSsl;
  const isV2 = status.aliyun.apiVersion === 'v2';
  const config = isAliyun ? status.aliyun : status.acme;
  const dnsReady = config.dnsProvider === 'freedns'
    ? config.freednsUsername && (config.hasFreednsPassword || config.hasFreednsSession)
    : config.zoneId && config.hasApiToken;
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [localError, setLocalError] = useState('');
  const running = busy || status.running?.length > 0;
  const domainKey = (values) => [...new Set(values.map((value) => value.trim().toLowerCase()))].sort().join(',');
  const scopeMatches = !expectedDomains.length || domainKey(expectedDomains) === domainKey(isAliyun ? [config.domain || ''] : config.domains);
  const ready = scopeMatches && (isAliyun ? config.accessKeyId && config.hasAccessKeySecret && config.domain && config.dnsZone : dnsReady && config.email && config.domains.length && (!isZeroSsl || (config.eabKid && config.hasEabHmacKey)));
  const certificate = certificates.find((item) => item.id === config.certificateId);
  const pending = isAliyun && config.order;
  const needsAssociation = pending && !pending.id;
  const issue = () => {
    if (!pending && (isAliyun || isZeroSsl || config.environment === 'production') && !window.confirm(isAliyun ? '将使用阿里云免费额度申请一张新证书，不会购买付费套餐。继续吗？' : isZeroSsl ? '将通过 ZeroSSL 申请一张新证书。继续吗？' : '正式签发将计入 Let’s Encrypt 限额。继续吗？')) return;
    void onIssue();
  };
  const retry = () => { if (window.confirm('重新申请可能使用新的免费额度。建议先在阿里云处理失败订单，确定继续吗？')) void onRetry(); };
  const reset = () => { if (window.confirm('请先在阿里云控制台确认：本次申请没有生成任何订单。重置后将清除本次申请并关闭自动轮换，旧证书不变。确认云端没有订单吗？')) void onReset(); };
  const associate = async (event) => { event.preventDefault(); const result = await onAssociate(orderId); if (result !== true) setLocalError(result?.error?.message || '关联失败'); else { setLocalError(''); setOrderId(''); } };
  const renewalAt = certificate?.validTo ? new Date(Date.parse(certificate.validTo) - config.renewDays * 86400000).toLocaleDateString() : null;
  return <section className="view automation-page" aria-label="证书签发">
    {expectedDomains.length ? <Notice>当前规则域名：{expectedDomains.join('、')}。{!scopeMatches ? '请先打开设置，确认并保存这些域名。' : '申请成功后自动选入当前规则，保存规则后生效。'}{isAliyun && expectedDomains.length > 1 ? '阿里云免费证书仅支持单域名，请使用 Let’s Encrypt 或上传多域名证书。' : ''}</Notice> : null}
    <div className="issuance-providers" aria-label="证书签发服务">{[['aliyun-free', '阿里云免费证书', '中国站 · 单域名 · 免费额度', 'bi-cloud-check'], ['acme', 'Let’s Encrypt', 'DNS-01 · Cloudflare / FreeDNS', 'bi-shield-check'], ['zerossl', 'ZeroSSL', 'ACME · DNS-01 · 需 EAB', 'bi-patch-check']].map(([value, label, note, icon]) => <button key={value} type="button" aria-pressed={status.provider === value} className={`issuance-provider${status.provider === value ? ' selected' : ''}`} disabled={running} onClick={() => { if (value === status.provider) return; if (!window.confirm('切换签发方式会重置该服务的自动签发进度（ACME 账户密钥、关联证书 ID 等）。已签发的证书与代理规则不变。继续吗？')) return; void onSave({ provider: value }); }}><Icon name={icon} /><span><strong>{label}</strong><small>{note}</small></span><Icon name={status.provider === value ? 'bi-check-circle-fill' : 'bi-circle'} /></button>)}</div>
    <article className="matte-surface certificate-surface"><div className="section-heading"><div><h2>{isAliyun ? '阿里云自动签发' : isZeroSsl ? 'ZeroSSL 自动签发' : 'Let’s Encrypt 自动签发'}</h2><p>{isAliyun ? (isV2 ? '使用已领取的免费实例，自动验证、签发并轮换。' : '使用旧版资源包，自动验证、签发并轮换。') : `${config.dnsProvider === 'freedns' ? 'FreeDNS' : 'Cloudflare'} DNS-01 签发与轮换，不依赖 DDNS 是否启用。`}</p></div><button className="secondary-button" disabled={running} onClick={() => setOpen(true)}><Icon name="bi-sliders" />设置</button></div>
      <div className="automation-domain"><span className="automation-service-icon"><Icon name="bi-shield-lock" /></span><div><strong>{isAliyun ? config.domain || '尚未配置证书域名' : config.domains.join('、') || '尚未配置证书域名'}</strong><small>{config.autoRenew ? `提前 ${config.renewDays} 天自动轮换` : '自动轮换未开启'}{isAcmeCa ? ` · ${isZeroSsl ? 'ZeroSSL 正式' : config.environment === 'production' ? '正式环境' : '测试环境'}` : ''}</small></div><Chip tone={config.lastError ? 'warning' : config.phase === 'issued' ? 'healthy' : 'disabled'}>{running ? '正在处理' : phases[config.phase] || config.phase}</Chip></div>
      <dl className="automation-facts"><div><dt>当前证书到期</dt><dd>{date(certificate?.validTo)}</dd></div><div><dt>预计开始轮换</dt><dd>{config.autoRenew ? renewalAt || '首次自动申请' : '自动轮换未开启'}</dd></div><div><dt>最近成功签发</dt><dd>{moment(config.lastSuccessAt)}</dd></div></dl>
      {isAliyun ? <><ol className="issuance-progress" aria-label="签发流程">{['免费额度', 'DNS 验证', 'CA 签发', '热更新'].map((label, index) => <li key={label} className={index === (['issued', 'cleanup'].includes(config.phase) ? 3 : config.phase === 'process' ? 2 : config.phase === 'domain_verify' ? 1 : 0) && config.phase !== 'idle' ? 'current' : ''}><span>{index + 1}</span>{label}</li>)}</ol><div className="issuance-quota"><div><strong>{isV2 ? '已领取的免费实例' : '自动申请资源包'}</strong><span>{config.quota ? `${config.quota.estimated ? '最多可申请' : '可用'} ${config.quota.remaining} / ${isV2 ? '实例' : '资源包'} ${config.quota.total}` : '尚未查询'}<small>{config.quota ? `已申请 ${config.quota.used} · 已签发 ${config.quota.issued} · ${moment(config.quota.checkedAt)}` : (isV2 ? '查询可供此域名使用的空闲免费实例' : '查询当前 AccessKey 的旧版免费资源包')}</small></span></div><button className="secondary-button compact-button" disabled={running || !config.accessKeyId || !config.hasAccessKeySecret} onClick={onQuota}><Icon name="bi-arrow-clockwise" />查询额度</button></div><details className="automation-details" open={Boolean(config.quota && config.quota.remaining === 0)}><summary>免费实例与自动轮换</summary><p>{isV2 ? '先在阿里云领取免费实例，应用会自动选取空闲实例完成申请、DNS 验证与下载。临期轮换使用下一张空闲实例；用完后停止并提醒，不会下单。' : '旧版累计申请次数包含失败申请；可申请上限按总额减已签发估算，以云端受理为准。'}</p><p><a href="https://yundun.console.aliyun.com/?p=cas_buy&amp;microFrontVersionName=newInstance#/testSSL/cn-hangzhou" target="_blank" rel="noreferrer">领取免费实例</a> · <a href="https://yundun.console.aliyun.com/?p=cas#/instance/test/cn-hangzhou" target="_blank" rel="noreferrer">查看新版实例</a></p><p>选择「个人测试证书（免费）＋基础版＋不需要人工服务」，确认应付 ¥0。未知规格和付费证书不会使用。</p>{config.quota?.excluded ? <p>另有 {config.quota.excluded} 个实例未能确认为支持的免费规格，已排除。</p> : null}</details>{pending ? <Notice>{pending.id ? `订单 ${pending.id} · ${phases[pending.phase] || pending.phase}${pending.dnsName ? ` · ${pending.dnsName}` : ''}` : '提交结果待核对。请从阿里云控制台找到本次申请的订单 ID，关联后继续。'}<small>关闭页面或重启应用不会重复申请；正在处理的订单会继续跟进。</small></Notice> : null}{needsAssociation ? <form className="associate-order" onSubmit={associate}><Field label="关联本次申请的订单 ID"><input inputMode="numeric" pattern="[0-9]+" required value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="阿里云控制台中的订单 ID" /></Field><button className="secondary-button" disabled={running}>关联订单</button></form> : null}</> : null}
      {localError || config.lastError ? <Notice error>{localError || config.lastError}{config.lastErrorCode ? <><br /><small>诊断代码：{config.lastErrorCode}</small></> : null}{config.lastErrorDetail ? <><br /><small>UserID：{config.lastErrorDetail.userId} · 已保存密码长度：{config.lastErrorDetail.passwordLength} 字符</small></> : null}</Notice> : null}
      {needsAssociation ? <div className="automation-actions"><button type="button" className="secondary-button" disabled={running} onClick={reset}>确认无订单，重置申请</button></div> : null}
      {status.demoMode ? <Notice>本地演示模式，不请求云端、不消耗额度，不生成真实证书。</Notice> : null}
      {!certificate && !pending ? <p className="automation-purpose">{expectedDomains.length ? "签发成功后自动选入当前规则，保存规则后生效。" : "在代理规则的 HTTPS 与证书中选择此证书，后续轮换自动更新。"}</p> : null}
      <div className="automation-actions"><button className="primary-button" disabled={running || !ready || needsAssociation || pending?.phase === 'verify_fail'} title={!ready ? '先完成签发设置' : ''} onClick={issue}><Icon name={running ? 'bi-arrow-repeat' : pending ? 'bi-arrow-clockwise' : 'bi-shield-plus'} />{running ? '正在处理…' : pending ? '继续查询订单' : certificate ? '立即轮换' : '立即签发'}</button>{pending?.phase === 'verify_fail' ? <button className="secondary-button" disabled={running || !scopeMatches} onClick={retry}>重新申请</button> : null}<button className="secondary-button" onClick={onCertificates}><Icon name="bi-collection" />查看证书</button>{isAliyun ? <a href="https://yundun.console.aliyun.com/?p=cas" target="_blank" rel="noreferrer">领取额度 / 查看订单<Icon name="bi-box-arrow-up-right" /></a> : null}</div>
    </article>{status.provider === 'aliyun-free' ? <IssuanceLog status={status} onRefresh={onRefresh} /> : null}<IssuanceEditor open={open} provider={status.provider} integration={status} expectedDomains={expectedDomains} busy={running} onClose={() => setOpen(false)} onSave={onSave} />
  </section>;
}
