# 留言板上线：Cloudflare 端需要手动做的事

留言板和私有角色 SQLite、R2 图片完全分离。新留言默认 `pending`，只在你手动点击“通过并公开”后才会展示；首页显示最近 10 条已公开留言，表情详情只显示该 instance 自己最近 10 条已公开留言。审核页会显示留言状态以及来源（首页，或表情详情的 `instance_id`）。**下列 Cloudflare 资源未配齐时投稿表单不会开放**；不要把密钥写入 Git、`config/site.json` 或给访客。

## 1. 建立独立 D1 数据库

Cloudflare 控制台 → D1 SQL database → Create Database，建议命名 `rhodes-guestbook`。进入该数据库的 Console，把 [db/guestbook.sql](../db/guestbook.sql) 的全部 SQL 贴入执行。它只建 `guestbook_messages` 表和索引，不改原工程的数据库。

如果你之前已经执行过旧版 `db/guestbook.sql`，不要重建或清空 D1；只需在现有留言库 Console 各执行一次以下增量迁移，已有留言会默认标为来自首页：

```sql
ALTER TABLE guestbook_messages
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'home'
  CHECK (source_type IN ('home', 'instance'));
ALTER TABLE guestbook_messages
  ADD COLUMN source_id TEXT NOT NULL DEFAULT '';
```

如果是新建数据库并已运行当前版 `db/guestbook.sql`，不要再运行这段迁移。

Cloudflare 控制台 → Workers & Pages → `123rhodes-emotes` → Settings → Bindings → Add → D1 database：

- Variable name **必须是** `GUESTBOOK_DB`
- Database 选择刚建立的 `rhodes-guestbook`

绑定后需要重新部署 Pages。[Cloudflare 的 D1 控制台说明](https://developers.cloudflare.com/d1/get-started/) · [Pages 绑定说明](https://developers.cloudflare.com/pages/functions/bindings/)

## 2. 建立 Turnstile 验证

Cloudflare → Turnstile → Add widget，加入当前域名 `123rhodes-emotes.pages.dev`；未来使用自定义域名时也加进去。公开的 **sitekey** 填入 [config/site.json](../config/site.json) 的 `guestbook.turnstileSiteKey`。不要把 **secret key** 填在此文件或 Git 中。

Pages 项目 → Settings → Variables and Secrets → Add，创建加密 secret：

- `TURNSTILE_SECRET_KEY` = Turnstile 的 secret key

后端会调用 Siteverify，并核对 token 的 hostname。只有前端显示验证框、不配置此 secret，是不能投稿的。[Turnstile 验证说明](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 3. 设置私用审核密钥

在本机生成一条独立、足够长的随机密钥，例如：

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

把输出只保存到密码管理器，并在 Pages 的 Variables and Secrets 中创建另一个加密 secret：

- `GUESTBOOK_ADMIN_KEY` = 刚生成的随机密钥（至少 32 字符）

不要沿用 R2 密钥、GitHub token、四位 PIN 或个人常用密码。访问 `https://123rhodes-emotes.pages.dev/guestbook-admin.html`，输入密钥后查看待审核、通过或排除；也可以切到已通过/已排除列表，把误操作退回待审核。密钥仅在该页面当前内存中使用，刷新需重新输入；页面地址不在导航中，但**安全性依赖服务端密钥检查，不依赖地址隐藏**。

## 4. 构建与验收

当前仓库中的 `guestbook.turnstileSiteKey` 仍为空，生产接口目前报告留言板未启用。你完成 D1、Turnstile 与两个 secret 的配置后，把公开 sitekey 写入 [config/site.json](../config/site.json) 的 `guestbook.turnstileSiteKey`，再在仓库中运行：

```bash
python3 tools/build.py
python3 tools/build.py --check
git add config/site.json db/guestbook.sql functions/api/guestbook.js functions/api/guestbook/admin.js guestbook.js guestbook-admin.js app.js styles.css content/copy.zh-CN.json templates index.html instance.html privacy.html guestbook-admin.html README.md docs/GUESTBOOK_SETUP.md
git commit -m "config: enable guestbook Turnstile"
git push
```

Cloudflare Secrets 和 D1 binding 都要在生产环境配置，保存后重新部署。上线检查：

1. 首页与具体表情详情的留言区出现输入框及 Turnstile；如果仍显示“准备中”，核对 `GUESTBOOK_DB`、`TURNSTILE_SECRET_KEY`、`GUESTBOOK_ADMIN_KEY`、sitekey 和重新部署。
2. 用测试文字提交，访客列表**立即不应出现**。
3. 审核页会标明 `待审核 / 已公开 / 已排除` 和发起位置。选“通过并公开”后，首页与对应详情页显示正文和留言时间；“排除”则始终不公开。公开区只显示最近 10 条。
4. 试一次错误密钥，确保不能打开待审核列表。

本地 `python3 -m http.server` 只预览静态页面，不会运行 Pages Functions 或 D1；真实投稿需在 Cloudflare 部署后测试。公开接口只返回已通过的留言，后台不在 D1 保存访客 IP。没有账号、图片上传、外链或自动公开。若遇到刷屏，可在 Cloudflare 配置针对 `POST /api/guestbook` 的限速规则；Turnstile 不等于绝对防刷。
