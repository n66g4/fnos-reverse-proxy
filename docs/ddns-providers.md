# DDNS 云服务商配置

DDNS 在应用内实现，能力对齐 [DDNS-Go](https://github.com/jeessy2/ddns-go)：多任务、多服务商、多域名、IPv4/IPv6、接口/网卡/命令取 IP、Webhook、Callback、近 50 条日志与自定义参数。它不负责证书签发，也不会更改飞牛系统证书。

## 在应用中设置

1. 打开「DDNS」，可 **新建任务** 或编辑已有任务；「全局设置」配置同步间隔、缓存次数与 Webhook。
2. 每个任务选择 **DNS 服务商**，填写凭据。域名的权威 DNS 应已指向该服务商。
3. 分别启用 IPv4 / IPv6：选择取 IP 方式（接口、网卡或命令），填写域名列表（每行一个，支持多级域名）。
4. TTL、Cloudflare 代理、线路与自定义参数按服务商需要填写。
5. 保存后先 **测试**，再 **同步**；确认无误后开启任务的定时同步。

旧版「单条 A/AAAA」配置会在加载时自动迁移为第一个任务，凭据与域名保留。

## 取 IP

- **接口**：默认多个公共服务（花生壳 / 3322 / ipip / ipify 等，国内优先），失败时依次尝试；也可自行填写 URL。
- **网卡**：填写网卡名或 `/正则/`，从本机地址中选取公网 IPv4/IPv6。
- **命令**：在 NAS 上执行命令并解析 stdout 中的首个公网地址（请谨慎，命令以应用权限运行）。

全局间隔默认 300 秒；`cacheTimes` 表示本地 IP 连续相同 N 次后再比对云端（对齐 DDNS-Go 的快检慢比思路）。

## 服务商

支持：Cloudflare、阿里云 DNS、阿里云 ESA、腾讯云 DNS、DNSPod、华为云、百度云、Porkbun、GoDaddy、Namecheap、NameSilo、Dynadot、DNSLA、时代互联、Eranet、Tnethk、Gcore、EdgeOne、IBM NS1 Connect、雨云、deSEC、**Callback**。

### Cloudflare

填写 Zone ID 与 API Token（DNS 编辑权限）。可选代理；代理开启时 TTL 使用自动。

### 阿里云 DNS / 腾讯云 DNS

使用 RAM / CAM 密钥与 DNS 主域名。阿里云可自动识别主域名。线路默认分别为 `default` 与 `默认`。

### Callback

URL / Body 支持 `#{ip}` `#{domain}` `#{recordType}` `#{ttl}` 等变量；Body 为空则 GET，否则 POST。可用于对接未内置的第三方 DNS。

### 其他 HTTP 服务商

按各服务商控制台创建 API Key / Secret，填写主域名（dnsZone）或 Zone。部分能力可通过「自定义参数」扩展（例如阿里云 ESA 的 `customUrl` 模板）。

## Webhook

同步结束后回调。变量与 DDNS-Go 一致：`#{ipv4Addr}` `#{ipv4Result}` `#{ipv4Domains}` 以及 IPv6 同名变量、`#{timestamp}`。

## 安全与失败处理

- 密钥不回显、不进入导出或诊断包。留空表示保留旧密钥。
- 只修改名称、类型与线路匹配的目标；冲突、暂停、锁定记录会拒绝写入。
- `DEMO_MODE=1` 不访问云 API、不读取公网 IP、不修改 DNS。

## 升级兼容

原单记录 Cloudflare / 阿里云 / DNSPod 配置自动迁入 `tasks[0]`，三套经典凭据保存在 `pools` 中以便切换服务商时恢复。证书签发配置不受影响。

旧版扁平字段（`provider` / `recordName` / `intervalMinutes` 等）的读写仍可用：读接口镜像**当前主任务**（优先第一个已启用任务）；写接口只 patch 该主任务，**不会清空**其余 `tasks[]`。多任务请优先使用 `tasks` / `webhook` / `intervalSeconds` 完整文档。
