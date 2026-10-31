# fnOS 反向代理

面向飞牛 fnOS 的原生多协议反向代理。界面为磨砂质感，随系统切换亮暗色，适配桌面与移动端。规则以卡片展示来源→目标映射，支持快捷启停。

项目地址：<https://github.com/n66g4/fnos-reverse-proxy>

当前源码版本：**1.0.18**。

## 主要功能

### 代理规则

- 协议按需组合：HTTP / HTTPS / WebSocket / WSS / TCP / UDP，以及同端口 TCP+UDP
- 来源支持离散端口与连续范围；目标可共享端口或等数量顺序映射
- 新增、编辑、复制、启停、删除、搜索、筛选与连通性检测
- 域名、自定义头、真实 IP、访问控制、超时、上传限制、HSTS、目标证书校验、定时启停
- 运行统计（连接、请求、流量、错误、最近客户端）写入应用数据目录，正常重启后可恢复

### 域名与证书

应用内分三块：**我的证书**、**自动申请**、**系统 HTTPS**。

| 类型 | 说明 |
|------|------|
| 应用证书 | 上传或自动签发后入库；供本应用 HTTPS/WSS 规则绑定；私钥 `0600`，不进页面 / API / 导出 / 诊断包 |
| fnOS 系统证书 | 只读镜像系统已有证书，可被规则选用，应用内不可删改（实验性） |
| 系统 HTTPS 部署 | 可选地把应用库中的正式证书部署到 fnOS 已手动导入（`upload`）的目标；不覆盖系统自带证书（实验性，见 [docs/fnos-deployment.md](docs/fnos-deployment.md)） |

支持 PEM / CRT / CER / KEY / DER / PFX / P12 多文件导入与自动解析；签发结果按叶子证 + 中间证（fullchain 形态，一般不含根）落盘。另支持外部 HTTP 证书推送绑定。

**自动申请**（与 DDNS 凭据相互独立）：

- 阿里云中国站免费证书 V1 / V2（AliDNS 验证、进度与临期轮换；只用已有免费额度或已领取实例，不代购）→ [docs/aliyun-free-certificates.md](docs/aliyun-free-certificates.md)
- Let’s Encrypt / ZeroSSL（ACME DNS-01：Cloudflare 或 FreeDNS）→ [docs/acme-dns-issuance.md](docs/acme-dns-issuance.md)

### DDNS

应用内实现，能力对齐 [DDNS-Go](https://github.com/jeessy2/ddns-go)：多任务、多服务商、多域名、IPv4/IPv6、接口 / 网卡 / 命令取 IP、Webhook / Callback、近 50 条任务日志。默认公网 IP 接口国内优先并自动回退（花生壳、3322、ipip、ipify 等）。旧版单记录配置会迁移为第一个任务。

说明与服务商列表：[docs/ddns-providers.md](docs/ddns-providers.md)。DDNS 只改 DNS 记录，不处理 CGNAT / 入站限制，也不改系统证书。

### 其他

- Webhook 通知、局域网目标发现、配置导入导出、诊断包
- 「日志」页为全应用运行日志（`app.log`）；DDNS 页内另有独立的近 50 条业务日志，两者不混用

## 证书用在哪里

证书只用于本应用直接承接 HTTPS / WSS 时的 TLS 握手，再转发到目标。HTTP 明文、TCP / UDP 透传不需要在本应用选证。

优先使用应用证书。系统证书只读兼容依赖 fnOS 内部结构，升级后可能失效；读取失败时会尽量沿用上一份已校验副本。

## 本地开发与验证

```bash
npm install
npm --prefix backend install
npm run start:local
npm run check
```

本地预览：`http://127.0.0.1:5178/app/reverse-proxy/`。演示模式不会按规则监听真实端口。

## 生成 FPK

```bash
npm run package:fpk
```

会构建前端、整理生产后端依赖，并用官方 `fnpack` 生成并校验 `dist/reverse-proxy.fpk`。可用 `FNPACK_PATH` 指定 `fnpack`。

仓库只保留可复现构建的源码、fnOS 元数据与脚本；依赖、构建产物、本机缓存、运行数据与私钥不入库。可安装包请从 GitHub Releases 获取。

## 安全说明

- Web 与代理以独立应用用户运行；低端口仅需 `CAP_NET_BIND_SERVICE`
- 系统证书部署由安装包内受限 root 助手经本机 Unix Socket 完成，无需另装组件
- 部署仅更新 fnOS 中已核验的手动导入目标；新旧 DNS SAN 须一致；失败回退；自动部署须先有一次成功的手动验证
- 阿里云 V2 不会代领实例；额度用尽即停，保留旧证书

Copyright © 2026 Gen. All rights reserved.
