# 真实图库发布到 R2

GitHub 只放代码。SQLite、原漫画、后台 panel 与审核历史不上传。R2 存放经过筛选的索引、人物裁切展示图、整列低清预览和高清重新编码的封面背景。

当前本地包：4,803 张 crop + 683 张预览，共 5,486 个 WebP，约 76.2 MB；清单约 1.66 MB。339 个篇目全部匹配官方具体篇目链接，368 位角色。不含 120 个 NPC 实例。

## 现在可以看真实效果

在仓库根目录执行：

```bash
python3 tools/build.py
python3 tools/preview.py --port 4174
```

打开 http://127.0.0.1:4174/ 。预览服务只开放网站文件和 publish/site 中的公开副本；不开放内部数据库、环境文件和目录浏览。远程服务器可将 4174 端口转发到本机。

## 1. 在 Cloudflare 准备专用 Bucket

使用现有私有 Bucket `123rhodes-db`。在 Pages 项目的 Settings → Bindings 配置 R2 bucket：变量名 `media`，Bucket `123rhodes-db`。Production 和 Preview 分别检查；添加后重新部署才能生效。不需要开启 r2.dev、自定义素材域名或 CORS。[官方 binding 说明](https://developers.cloudflare.com/pages/functions/bindings/)

Pages Function 通过 `env.media` 读取；浏览器访问本站 `/data/release.json` 和 `/media/...`。只开放公开清单及 crops、source-previews、backgrounds 三个目录下符合内容哈希格式的 WebP，不提供任意 bucket key 查询或目录列表。仅支持 GET/HEAD，带 ETag；索引缓存60秒，哈希图片长期缓存。读取失败返回简短错误，不泄露内部信息。`_routes.json` 限定 Function 路径，其余页面保持静态服务。

创建限定此 Bucket 的 S3 读写凭据，保留 Account ID、Access Key ID、Secret Access Key。不要把密钥放进前端、GitHub 或聊天。

## 2. 在服务器配置本地环境文件

把 .env.example 复制成被忽略的 .env，填好：

```dotenv
R2_ACCOUNT_ID=你的AccountID
R2_BUCKET=123rhodes-db
R2_ACCESS_KEY_ID=你的AccessKeyID
R2_SECRET_ACCESS_KEY=你的SecretAccessKey
```

文件权限建议只允许当前用户读写。脚本只读取这四项，不执行 shell，不把值打印到终端。也可以通过环境变量提供，无需 .env。

上传需要 Python 3.10+ 和 requirements-publish.txt 中的依赖，建议在此仓库独立 .venv 安装；不要为了上传改动内部模型环境。构建/预览仍只需 Python 标准库。

## 3. 先检查，再上传

```bash
python tools/upload_r2.py --dry-run
python tools/upload_r2.py
```

第一条只验证本地白名单和文件哈希，不需要凭据、不会访问 R2。第二条上传到现有 bucket，保留 `data/`、`media/` 前缀。Binding 负责线上读取授权，但不能代替服务器上传凭据；仍需在本地配置 S3 凭据，或自行上传 publish/site 下的文件。原始 SQLite 不上传。

脚本按 R2 的 S3 接口上传；同名内容哈希文件且大小相同会跳过。全部图片成功后才更新 data/release.json，失败可以重跑，不删除旧对象。[官方 boto3 示例](https://developers.cloudflare.com/r2/examples/aws/boto3/)

上传工具保留可选的 --configure-cors 供将来改为跨域发布时使用；当前 binding 方案不要加这个参数。

## 4. 让 Pages 读取 R2

保持 config/site.json 使用同域地址：

```json
"publicDataBaseUrl": ""
```

正常 GitHub → Pages 构建保留仓库根目录的 functions/，构建命令 python3 tools/build.py，输出目录为仓库根目录。无需把上传用 S3 密钥设置到 Pages；运行时只用 media binding。代码部署并上传公开包后，访问 https://123rhodes-emotes.pages.dev/data/release.json 验证，再打开首页和搜索页。

503 表示 binding 未生效或读取故障；404 表示公开对象未上传/路径不符。不要把 SQLite 文件当成 release.json 上传。GitHub 只存代码，R2 存导出的公开副本，内部标签和审核记录留在后台。

## 后续更新人工标签

使用具备 Pillow 的 Python，重新运行只读导出：

```bash
python tools/export_public.py \
  --database ../character_index/database/index.sqlite \
  --raw-root ../123罗德岛_官方原图
python tools/upload_r2.py
```

导出使用 global human confirmed/trusted 身份，解析已合并身份，保留当前 instance_id。对人物 crop 最长边限制 512px，对来源整列同时限制宽180px/长640px；重新编码去除元数据。只读 SQLite，不跑 detector、embedding 或 ranker。官方目录有新增也不会自动导入新的漫画；仅匹配数据库已有篇目。

数据更新无需修改页面代码；release.json 缓存最长约60秒，图片名包含内容哈希。新增的展示文件上传，旧对象保留；此轮未实现或执行清理操作。

## 封面背景

封面原图只在本地 `../123罗德岛_官方原图/封面图`。运行 `.venv-publish312/bin/python tools/publish_backgrounds.py --upload`，生成 1920×1080 原尺寸、高画质重新编码且不含原图元数据的 WebP 并上传到 R2；将输出的 `/media/backgrounds/...` 路径填入 `config/site.json` 的 `theme.backgroundImages`。每次运行 `python3 tools/build.py` 从该列表随机选一张；把只包含公开 R2 路径的 `config/selected-background.json` 和生成的 HTML 一起提交，Pages 才能在不同部署方式下保持一致。页面以 38% 不透明度呈现，不更新人物发布清单，也不会把原始文件或重新编码文件提交到 GitHub。
