# ACME / DNS-01 证书签发

支持 **Let’s Encrypt**、**ZeroSSL**（需 EAB KID / HMAC Key）与 **阿里云免费证书**。Let’s Encrypt 与 ZeroSSL 使用 DNS-01 验证，可选 **Cloudflare** 或 **FreeDNS (afraid.org)** 写入 TXT 记录。凭据与 DDNS 独立保存，不会进入配置导出。

## Cloudflare DNS-01

填写目标 Zone 的 Zone ID 与具备 DNS 编辑权限的 API Token。Let’s Encrypt 可选测试/正式环境；ZeroSSL 仅正式目录。

## FreeDNS DNS-01

FreeDNS 没有稳定的 TXT 记录 API，应用通过 **用户名/密码登录** 获取会话 Cookie，再提交网页表单写入 `_acme-challenge.*` TXT。

限制与说明：

- **公共共享域**若要求安全码，无法自动完成验证。
- 依赖子域列表页的 HTML 结构，FreeDNS 改版可能导致失败；可在设置中 **清除 FreeDNS 会话** 并用密码重新登录。
- 建议保留已保存的密码，不要仅依赖会话 Cookie；Cookie 过期后会自动尝试用密码重新登录，无密码时需重新保存凭据。
- 域名须已在 FreeDNS 账户中托管；应用会按后缀自动匹配 `domain_id`。

## 切换签发方式

在界面切换 Let’s Encrypt / ZeroSSL / 阿里云时会重置对应 ACME 账户密钥与自动签发关联状态；**已入库证书与代理规则不变**。
