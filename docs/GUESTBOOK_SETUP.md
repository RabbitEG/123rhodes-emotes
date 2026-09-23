# 留言板上线：Cloudflare 端需要手动做的事

留言板和私有角色 SQLite、R2 图片完全分离。代码已经包含公开列表、免注册投稿、Turnstile 校验、待审核队列和审核页。**下列资源未配齐时投稿表单不会开放**；不要把密钥写入 Git、`config/site.json` 或给访客。

## 1. 建立独立 D1 数据库

Cloudflare 控制台 → D1 SQL database → Create Database，建议命名 `rhodes-guestbook`。进入该数据库的 Console，把 [db/guestbook.sql](../db/guestbook.sql) 的全部 SQL 贴入执行。它只建 `guestbook_messages` 表和索引，不改原工程的数据库。

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

完成 sitekey 填写后，在仓库中运行：

```bash
python3 tools/build.py
python3 tools/build.py --check
git add config/site.json content/copy.zh-CN.json index.html search.html about.html privacy.html 404.html guestbook-admin.html _headers
git commit -m "config: enable guestbook Turnstile"
git push
```

Cloudflare Secrets 和 D1 binding 都要在生产环境配置，保存后重新部署。上线检查：

1. 首页留言区出现输入框及 Turnstile；如果仍显示“准备中”，核对 `GUESTBOOK_DB`、`TURNSTILE_SECRET_KEY`、sitekey 和重新部署。
2. 用测试文字提交，访客列表**立即不应出现**。
3. 审核页选“通过”，刷新首页后显示正文和留言时间；“排除”则始终不公开。
4. 试一次错误密钥，确保不能打开待审核列表。

本地 `python3 -m http.server` 只预览静态页面，不会运行 Pages Functions 或 D1；真实投稿需在 Cloudflare 部署后测试。公开接口只返回已通过的留言，后台不在 D1 保存访客 IP。没有账号、图片上传、外链或自动公开。若遇到刷屏，可在 Cloudflare 配置针对 `POST /api/guestbook` 的限速规则；Turnstile 不等于绝对防刷。
