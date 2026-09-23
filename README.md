# 罗德岛表情簿

《123罗德岛！？》非官方粉丝表情检索站。

线上：<https://123rhodes-emotes.pages.dev/>

完整方案：[docs/SITE_PLAN.md](docs/SITE_PLAN.md) · 数据格式：[docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) · [R2 接入步骤](docs/R2_SETUP.md)

## 当前版本

浅紫/粉色贴纸册风格，居中首页：顶部真实 instance 持续横向慢速滚动 → 一个搜索框切换表情/篇目 → 首页统计和榜单 → 留言准备区与来源说明。搜索后进入独立的 search.html 结果页。

- 名称、别名、篇目编号搜索；角色/篇目/组合过滤；URL 分享、刷新和前后退恢复。
- 人物图片网格、继续加载、原始整列的低清出处预览、官方篇目外链。
- 四项总量、前十位角色出场占比环形图、六种角色榜前 30、双向/单向篇目共现比例和单篇出场记录前 30。
- 表情带按像素速度连续移动；随机/顺序控制实例排列，支持暂停/继续、手动往后看、悬停/聚焦暂停和系统减少动态效果。
- 手机适配、图片失败提示、清单缺失/错误状态和重试。

**真实图库已上线。** R2 保存 4,803 张人物 crop、683 张低清预览、339 个篇目、368 位角色；公开索引和素材不提交仓库，网站通过 Pages Function binding 读取。留言后端未开放。

本地真实预览：运行 `python3 tools/preview.py --port 4174`，打开 http://127.0.0.1:4174/ 。没有导出包的普通 clone 仍可用下述静态预览检查空状态。

## 人工修改所有文案

只改 **[content/copy.zh-CN.json](content/copy.zh-CN.json)**。每条包含：

```json
"site.name": {
  "text": "罗德岛表情簿",
  "note": "站名：导航、标题、页脚"
}
```

改 `text` 即可；`note` 是给你看的说明，不会显示在网页。key 不改名。带 `{count}`、`{episode}` 等占位符的文案保留这些名称，`slots` 用于防止误删。文本按纯文字处理，不接受 HTML。站名、页标题、按钮、输入提示、错误/空状态、统计解释、版权和隐私正文都在这个文件。

改完执行：

```bash
python3 tools/build.py
python3 -m http.server 4173 --bind 127.0.0.1
```

访问 <http://127.0.0.1:4173>。无需安装前端框架或 Python 依赖。

构建生成根目录 index.html / search.html / about.html / privacy.html / 404.html，并同步生成 _headers。不要直接修改这些生成文件。确认效果后：

```bash
python3 tools/build.py --check
git add content/copy.zh-CN.json index.html search.html about.html privacy.html 404.html _headers
git commit -m "docs: update site copy"
git push
```

当前 Cloudflare Pages 的 Git 部署继续读取生成结果，无需修改构建设置。只有浏览器加载的真实角色名、篇目名来自发布数据，不在文案表里。

## 改配色、背景和轮播

[config/site.json](config/site.json)：

| 配置 | 作用 |
| --- | --- |
| theme.accent | 主色，六位十六进制颜色 |
| theme.background | 底色 |
| theme.backgroundImage | 可选 /assets/ 下装饰背景路径；覆盖全页，低透明度，空字符串关闭 |
| carousel.enabled | 是否使用已发布图填入轮播 |
| carousel.mode | random / sequential |
| carousel.speedPixelsPerSecond | 每秒移动像素，默认22，范围5–60；从右向左连续滚动 |
| carousel.maxItems | 轮播最多图片数，4–32 |
| pageSize | 每批检索结果数量，默认 36 |
| releaseManifest | 发布清单路径，默认 /data/release.json |
| publicDataBaseUrl | 保持空值，通过本站 Pages Function 的 media binding 读取 R2 |

图片背景可放 `assets/background.webp` 后配置对应路径。纯色和星形/网点装饰不依赖外部资源。具体卡片尺寸、字体大小等样式在 styles.css 中修改。轮播优先使用发布清单的 featured_instance_ids，否则尽量均衡抽取不同角色。

## 统计与后续数据工作

所有数字只来自当前公开发布包。前端不读取 SQLite、不运行模型、不改身份标签。

| 指标 | 当前实现 / 数据条件 |
| --- | --- |
| 总篇目、总表情、总角色 | 已实现，按发布目录计算 |
| 总来源图片 | 已实现，来源图目录/显式总数/完整 image_id 可用；缺失显示 — |
| 出场次数榜 | 已实现，instance 数降序 |
| Episode 覆盖榜 | 已实现，不同 episode 数降序 |
| 稀客榜 | 已实现，至少收录一次，instance 数升序 |
| 客串王 | 已实现；需完整、已核实的本篇 cast |
| 无本篇客串榜 | 已实现；需完整 cast，按从未登记本篇的角色出场数排序 |
| 久未出现榜 | 已实现；需完整且唯一的篇目顺序；计算相隔篇数，不是天数 |
| 双向奔赴 | 已实现，Jaccard × 共同 episode 数；至少共同出现两篇 |
| 单相思 | 已实现，双方共现率差 × 较少/较多一方篇目数；比例差至少 10%，抑制超高频角色 |
| 单篇出场记录 | 已实现，每个角色 × 篇目的实例数 |

榜单条目和图例点击后进入独立搜索结果页。当前篇目顺序已和官方目录核对，“久未出现榜”可用；内部 cast 包含全部已确认出场，不能直接算客串，两份客串榜暂待可靠本篇资料。

后续计划：

- 配置 Pages R2 binding：media → 123rhodes-db，上传公开包后接通线上素材；无需公开 bucket 或配置跨域域名。上传凭据仅留本地。
- 整理可靠的本篇 cast，再启用两份客串榜。image_id 与篇目顺序已经齐全。
- 匿名留言板、人工审核、防刷与留言保存说明。
- Beta 共现分组可留待以后；当前只有共同出场统计，不解释为关系亲密度。

## 目录

```text
content/copy.zh-CN.json  唯一人工文案源（带中文说明）
templates/              页面模板与共享导航/页脚
tools/build.py          文案与模板生成程序
tools/export_public.py  只读数据库，白名单导出与展示图生成
tools/preview.py        页面 + 本地真实发布包的隔离预览
tools/upload_r2.py      上传公开展示资源，最后更新索引
config/site.json        主题、轮播、分页、数据地址
index.html              生成：首页、统一搜索、统计
search.html             生成：独立搜索结果页
about.html              生成：关于和版权
privacy.html            生成：隐私
404.html                生成：缺失页；也避免 Pages 把缺失 JSON 回退成首页
styles.css              共享视觉样式
app.js                  页面交互与发布数据读取
stats.js                纯公开数据统计与清单校验
assets/                 自制装饰素材（当前只有 SVG 图标）
docs/                   完整方案与数据协议
tests/browser.cjs       统计与浏览器验收（仅内存测试数据）
tests/real-data.cjs     本地真实数据浏览器验收
publish/site/           真实公开索引和展示副本，不进 Git
.env                   本地 R2 凭据，不进 Git
```

## 验证

`python3 tools/build.py --check` 检查生成内容是否最新；`python3 tests/copy_test.py` 在临时目录验证人工修改文案后的生成、转义与占位符检查。浏览器验收需要 Node.js、Playwright 和 Chromium，在本地静态服务器运行时执行 `node tests/browser.cjs`；可用 PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE 指定现有安装，SITE_TEST_URL 指定本地测试地址。

测试验证统计去重/缺字段处理、独立结果页、分页、URL 恢复、桌面/手机预览、CSP、连续滚动/暂停、错误重试。虚构数据通过浏览器请求拦截注入，不创建 data/release.json，也不进入生产页面。真实数据验证通过本地4174预览运行 `node tests/real-data.cjs`。截图存入忽略的 test-results/。

## 发布与版权

GitHub main 推送由现有 Cloudflare Pages 集成部署。根目录为输出目录，无需构建命令；推送前运行生成程序并提交源文件及生成文件。

私有 SQLite、原始漫画、内建 panel、审核记录、embedding、模型及临时导出包不得加入此仓库。公开图片只允许经筛选的展示副本和原始整列低清预览。

《明日方舟》和官方漫画素材归各自权利人所有。本站原创整理内容采用 CC BY-NC-SA 4.0，此许可不覆盖官方图片、第三方素材或访客留言。完整说明见关于页。
