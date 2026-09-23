# 罗德岛表情簿

《123罗德岛！？》非官方粉丝表情检索站。

线上：<https://123rhodes-emotes.pages.dev/>

完整方案：[docs/SITE_PLAN.md](docs/SITE_PLAN.md) · 数据格式：[docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)

## 当前版本

浅紫/粉色贴纸册风格，居中首页：顶部表情轮播 → 一个搜索框切换表情/篇目 → 首页统计和榜单 → 留言准备区与来源说明。

- 名称、别名、篇目编号搜索；角色/篇目/组合过滤；URL 分享、刷新和前后退恢复。
- 人物图片网格、继续加载、原始整列的低清出处预览、官方篇目外链。
- 四项总量、前五位角色出场占比环形图、六种角色榜、共现组合和单篇记录。
- 轮播支持随机/顺序、暂停/继续、手动下一组、悬停/聚焦暂停和系统减少动态效果。
- 手机适配、图片失败提示、清单缺失/错误状态和重试。

**当前尚未接入真实公开图集。** 页面没有漫画素材、内部数据库或示例统计数字；未发布时显示装饰颜文字和待收录状态。前端已能读取正式发布清单。留言后端未开放。

## 人工修改所有文案

只改 **[content/copy.zh-CN.json](content/copy.zh-CN.json)**。每条包含：

```json
"hero.line": {
  "text": "想找谁的表情？",
  "note": "搜索上方一句话"
}
```

改 `text` 即可；`note` 是给你看的说明，不会显示在网页。key 不改名。带 `{count}`、`{episode}` 等占位符的文案保留这些名称，`slots` 用于防止误删。文本按纯文字处理，不接受 HTML。站名、页标题、按钮、输入提示、错误/空状态、统计解释、版权和隐私正文都在这个文件。

改完执行：

```bash
python3 tools/build.py
python3 -m http.server 4173 --bind 127.0.0.1
```

访问 <http://127.0.0.1:4173>。无需安装前端框架或 Python 依赖。

构建把模板与文案生成根目录的 index.html / about.html / privacy.html / 404.html。不要直接修改这四个生成文件。确认效果后：

```bash
python3 tools/build.py --check
git add content/copy.zh-CN.json index.html about.html privacy.html 404.html
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
| carousel.intervalMs | 自动滚动间隔，至少 4000 毫秒 |
| carousel.maxItems | 轮播最多图片数，4–32 |
| pageSize | 每批检索结果数量，默认 36 |
| releaseManifest | 本站发布清单地址 |

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
| 最常见组合 | 已实现，两角色共同 episode 数，同篇多张不重复计 |
| 单篇出场记录 | 已实现，每个角色 × 篇目的实例数 |

榜单条目和图例可点击回到同一搜索区。cast 或篇目顺序资料缺失时，相关榜单显示缺资料提示，不把未知值计算为零。

后续计划：

- 完成只读白名单导出、逐篇核实官方链接、生成公开 crop 和整列低清预览，接入真实发布包。
- 补齐来源 image_id、本篇 cast、可靠篇目顺序，使全部榜单有可靠数据。内部 cast 若已自动包含所有实际出现角色，需先分清其与“本篇角色”的含义。
- 选择公开发布包的构建导入/部署方式：当前这些生成数据被 .gitignore 排除，GitHub 集成不会自动上传本地忽略文件。
- 匿名留言板、人工审核、防刷与留言保存说明。
- Beta 共现分组可留待以后；当前只有共同出场统计，不解释为关系亲密度。

## 目录

```text
content/copy.zh-CN.json  唯一人工文案源（带中文说明）
templates/              页面模板与共享导航/页脚
tools/build.py          文案与模板生成程序
config/site.json        主题、轮播、分页、数据地址
index.html              生成：首页、统一搜索、统计
about.html              生成：关于和版权
privacy.html            生成：隐私
404.html                生成：缺失页；也避免 Pages 把缺失 JSON 回退成首页
styles.css              共享视觉样式
app.js                  页面交互与发布数据读取
stats.js                纯公开数据统计与清单校验
assets/                 自制装饰素材（当前只有 SVG 图标）
docs/                   完整方案与数据协议
tests/browser.cjs       统计与浏览器验收（仅内存测试数据）
data/、media/           后续发布包，默认不进 Git
```

## 验证

`python3 tools/build.py --check` 检查生成内容是否最新；`python3 tests/copy_test.py` 在临时目录验证人工修改文案后的生成、转义与占位符检查。浏览器验收需要 Node.js、Playwright 和 Chromium，在本地静态服务器运行时执行 `node tests/browser.cjs`；可用 PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE 指定现有安装，SITE_TEST_URL 指定本地测试地址。

测试验证统计去重/缺字段处理、搜索、分页、URL 恢复、桌面/手机预览、CSP、轮播暂停、错误重试。虚构数据通过浏览器请求拦截注入，不创建 data/release.json，也不进入生产页面。截图存入忽略的 test-results/。

## 发布与版权

GitHub main 推送由现有 Cloudflare Pages 集成部署。根目录为输出目录，无需构建命令；推送前运行生成程序并提交源文件及生成文件。

私有 SQLite、原始漫画、内建 panel、审核记录、embedding、模型及临时导出包不得加入此仓库。公开图片只允许经筛选的展示副本和原始整列低清预览。

《明日方舟》和官方漫画素材归各自权利人所有。本站原创整理内容采用 CC BY-NC-SA 4.0，此许可不覆盖官方图片、第三方素材或访客留言。完整说明见关于页。
