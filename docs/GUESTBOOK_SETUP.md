# 留言板上线：Cloudflare 端需要手动做的事

留言板和私有角色 SQLite、R2 图片完全分离。新留言默认 `pending`，只在你手动点击“通过并公开”后才会展示；首页显示最近 10 条已公开留言，表情详情只显示该 instance 自己最近 10 条已公开留言。访客可以重抽匿名昵称，每条留言固定显示寄出时使用的昵称；审核页额外显示稳定的后台识别名，方便看出不同昵称是否来自同一访客。后台识别名不会出现在公开接口或页面。**不要把任何 secret 写入 Git、`config/site.json` 或给访客。**

## 1. 建立独立 D1 数据库

Cloudflare 控制台 → D1 SQL database → Create Database，建议命名 `rhodes-guestbook`。进入该数据库的 Console，把 [db/guestbook.sql](../db/guestbook.sql) 的全部 SQL 贴入执行。它会建立独立的访客与留言表及索引，不改原工程的数据库。

如果你之前执行过最初版 `db/guestbook.sql`，但还没有 `source_type/source_id` 两列，不要重建或清空 D1；只执行一次以下增量迁移，已有留言会默认标为来自首页：

```sql
ALTER TABLE guestbook_messages
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'home'
  CHECK (source_type IN ('home', 'instance'));
ALTER TABLE guestbook_messages
  ADD COLUMN source_id TEXT NOT NULL DEFAULT '';
```

如果是新建数据库并已运行当前版 `db/guestbook.sql`，不要再运行这段迁移。
如果这两列已经存在（例如你已完成上次留言来源迁移），跳过这段，不要重复执行 `ALTER TABLE`。

如果留言库已存在，请在上一步完成后，按顺序执行尚未应用的增量迁移：`0002_guestbook_anonymous_users.sql`、`0003_guestbook_first_nickname.sql`、`0004_guestbook_message_display_name.sql`。`0003` 为现有访客建立稳定的首个匿名识别名；`0004` 增加每条留言自己的显示昵称，并把旧留言固定为迁移前页面上显示的昵称。由于旧版本没有逐条保存昵称历史，无法还原更早的重抽记录。留言正文、审核状态、时间、来源和用户关联均不变。没有访客关联的旧留言显示“早期留言（未分配昵称）”。新建数据库运行当前版 `db/guestbook.sql` 即可，不执行增量迁移。

昵称由当前 R2 `data/release.json` 中的正式角色名生成，不使用临时身份或 NPC。首次成功投稿后，浏览器会收到一个随机、HttpOnly 的匿名 Cookie；D1 只保存它的 SHA-256 哈希、稳定的后台识别名、当前昵称和每条留言提交时的显示昵称，不存明文令牌或 IP。首次寄出前的预览/重抽不写入访客记录；寄出后仍可随时重抽，新留言使用新昵称，已有留言保留原显示名。后台用稳定识别名关联同一访客，公开区只返回每条留言的显示昵称。清理浏览器数据或换浏览器会视为新访客。当前分配的完整昵称（干员名 + `#` + 三位数字）互不重复，首昵称保留且不会再分配给其他访客。普通数字等概率；`799、328、174、290、310、996、007、042、083、226、114、514、886、985` 的权重为 5 倍，`325` 为 10 倍。每累计 10,000 个访客进入下一分配轮次，轮换干员候选顺序。

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

公开 sitekey 放在 [config/site.json](../config/site.json) 的 `guestbook.turnstileSiteKey`（它不是 secret）。修改后在仓库中运行：

```bash
python3 tools/build.py
python3 tools/build.py --check
git add db/guestbook.sql db/migrations/0002_guestbook_anonymous_users.sql db/migrations/0003_guestbook_first_nickname.sql db/migrations/0004_guestbook_message_display_name.sql functions/api/guestbook.js functions/api/guestbook/admin.js functions/api/guestbook/identity.js lib/guestbook.mjs guestbook.js guestbook-admin.js styles.css content/copy.zh-CN.json templates index.html instance.html privacy.html guestbook-admin.html README.md docs/GUESTBOOK_SETUP.md tests
git commit -m "feat: support rerollable anonymous guestbook names"
git push
```

Cloudflare 的 `GUESTBOOK_DB` binding、`TURNSTILE_SECRET_KEY`、`GUESTBOOK_ADMIN_KEY` 都要在生产环境配置。已有留言库应确认来源列已存在（最初版数据库才需要执行来源列迁移），并按缺失顺序完成 `0002`、`0003`、`0004`；**执行后再部署依赖新列的代码**。新建库运行当前 `db/guestbook.sql` 即可。管理页位于 `https://123rhodes-emotes.pages.dev/guestbook-admin.html`。上线检查：

1. 首页与具体表情详情的留言区出现输入框及 Turnstile；如果仍显示“准备中”，核对 `GUESTBOOK_DB`、`TURNSTILE_SECRET_KEY`、`GUESTBOOK_ADMIN_KEY`、sitekey 和重新部署。
2. 用测试文字提交，访客列表**立即不应出现**。
3. 审核页会标明后台识别名 → 本条显示名、`待审核 / 已公开 / 已排除` 和发起位置。访客重抽后，旧留言保留原昵称，新留言使用新显示名。通过后留言才公开；排除的留言始终不公开。公开区只显示最近 10 条。
4. 试一次错误密钥，确保不能打开待审核列表。
5. 同一浏览器跨首页/详情投稿应关联到同一匿名用户；重抽后旧留言保留原昵称，新留言显示新昵称，管理页中两条留言都显示同一个稳定识别名。另一浏览器得到不同首昵称；检查特殊数字权重和 10,000 人轮转。

本地 `python3 -m http.server` 只预览静态页面，不会运行 Pages Functions 或 D1；真实投稿需在 Cloudflare 部署后测试。匿名 Cookie 最长约 400 天并在成功留言或重抽昵称时续期；清除 Cookie 会生成新匿名身份。访客表中的哈希与首昵称需要保留，以维持后台身份关联并避免首昵称被其他访客占用。公开接口只返回已通过的留言；不记录 IP、账号或真实姓名，没有图片上传、外链或自动公开。若遇到刷屏，可在 Cloudflare 配置针对 `POST /api/guestbook` 的限速规则；Turnstile 不等于绝对防刷。
