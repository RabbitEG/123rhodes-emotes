# 站内使用统计：首次配置

本站的自建统计只服务于检索、内容热度和站点维护；不建立访客账号，不保存原始搜索词、IP、Cookie、完整 referrer、User-Agent 或请求头。统计数据库独立于留言板，也独立于后台 SQLite / R2。

## 1. 创建独立 D1

Cloudflare 控制台 → **Workers & Pages** → **D1** → Create database，建议名称 `rhodes-analytics`。在该数据库 Console 执行 [db/analytics.sql](../db/analytics.sql) 全部内容。脚本只创建 `analytics_*` 表、索引和聚合触发器；不要把它贴入留言板 D1 或私有角色数据库。

进入 Pages 项目 `123rhodes-emotes` → **Settings → Bindings → Add → D1 database binding**：

- Variable name：`ANALYTICS_DB`
- Database：`rhodes-analytics`

若你希望 Cloudflare Preview 部署也写入数据，请明确给 Preview 环境单独绑定一个测试 D1；不要让预览流量污染生产分析。保存后重新部署。Cloudflare 官方：[Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/) · [D1 开始使用](https://developers.cloudflare.com/d1/get-started/)。

## 2. 设置后台查看密钥

在本机生成一个仅用于此后台的随机密钥，并保存在密码管理器：

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Pages 项目 → **Settings → Variables and Secrets**，新增加密 secret：

- `ANALYTICS_ADMIN_KEY`：刚生成的字符串，至少 32 个字符。

不要写入 Git、`config/site.json`、`.env`、网址参数或聊天。私用页面是 `/analytics-admin.html`；输入的密钥仅存于当前页面内存，退出或刷新即清除。后台 API 只返回聚合报告，不提供逐条事件下载，也不会把密钥放进 URL 或浏览器持久存储。

## 3. 核对采集与隐私控制

重新部署后，在生产站点搜索、打开几张详情、点击原站链接，再进入 `/analytics-admin.html` 查看。首次需要等有事件写入后才会出现数据。未绑定 D1 时，浏览不受影响，事件会被丢弃；不会在本机排队补传。

浏览器端仅发送固定类型的事件：页面浏览、搜索提交/结果区间、角色/篇目建议选择、表情进入可视区、详情打开、原站跳转、匿名留言成功提交，以及公开清单加载失败。角色/篇目名称只在它精确命中公开目录时以公开 ID 聚合；自由文本搜索原文不会发送。搜索结果按 0、1–5、6–20、21–100、101+ 分桶。屏幕只分窄/宽两档，地区只用 Cloudflare 提供的国家代码。首页“搜索量榜”从长期按日聚合中统计角色搜索提交与角色提示选择，只公开每个角色的累计总次数，不公开逐人记录或原始搜索词。

- 浏览器的 DNT / GPC 会阻止采集；隐私说明页可关闭当前浏览器的站内统计。
- 后台隐藏国家代码样本不足 5 个短时会话的分组。
- 短时随机会话 ID 存于 `sessionStorage`，30 分钟无活动会换新值；有新事件写入时每天最多清理一次超过 30 天的会话关联。
- 有新事件写入时每天最多清理一次超过 90 天的明细事件；若网站完全没有新事件，清理会在下次写入后继续。数据库触发器只留下按日的聚合计数，可用于长期趋势；清理明细不删除聚合数。
- API 将一小批白名单事件合并提交，并限制 JSON 大小和事件数量；同一事件 ID 重试不会重复计数。事件写入失败不会影响正常浏览。
- 留言正文、原始 IP、完整 URL、原始查询词、设备指纹与任意自由文本不会进入分析 D1。Cloudflare 作为网站托管/网络服务商仍可能按其自身规则处理连接与安全日志，见本站隐私说明。

这些是**站内产品事件**，不是所有浏览器 HTTP 请求的计数。一次页面浏览不会被当成一个网络请求；静态 JS、图片、缓存命中等资产请求不会逐项写入本站 D1。若需要总体请求量、带宽或页面性能，请另看 Cloudflare 的项目 **Metrics / Web Analytics** 或适用域名的 **Analytics & Logs**。两边口径不同，不要相加：Cloudflare 的页面指标来自 beacon，HTTP Traffic 是边缘请求汇总；它们不是本项目的实例级点击记录。官方说明：[Pages Web Analytics](https://developers.cloudflare.com/pages/how-to/web-analytics/) · [Cloudflare Analytics](https://developers.cloudflare.com/analytics/)。

## 4. 防滥用与日常维护

统计接口是匿名写入端点；它只接受同源、有限字段和短 JSON，但同源检查不能阻止伪造请求。站点有真实公网域名且控制台套餐提供时，建议在 Cloudflare Security rules 中对 `POST /api/analytics` 设置宽松的速率限制；同时也可对 `POST /api/guestbook` 单独限速。规则太严会漏掉批量曝光事件。不要为了自建限速而把访客 IP 保存进 D1。见 [Cloudflare rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)。

长期聚合若需要清空，可在**analytics D1**的 Console 单独执行：

```sql
DELETE FROM analytics_events;
DELETE FROM analytics_daily_counts;
DELETE FROM analytics_maintenance;
```

这会清空站内统计，不影响留言、公开图库、R2 或后台数据库。变更采集字段或保留期时，也要同步更新 `db/analytics.sql`、本页和 `content/copy.zh-CN.json` 的隐私说明，再构建发布。

## 5. 本地测试

静态预览不会连接生产 D1，也不会收集或缓存事件。运行：

```bash
python3 tools/build.py
python3 tools/build.py --check
node tests/analytics.test.mjs
```

`ANALYTICS_DB` 和 `ANALYTICS_ADMIN_KEY` 是 Cloudflare Pages 运行时配置，不需要写进仓库 `.env`。
