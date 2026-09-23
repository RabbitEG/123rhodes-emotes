# 罗德岛表情簿

**123罗德岛！？人物表情检索** · 非官方粉丝站

一个轻量的静态检索站起步项目。站点只展示人工确认并经过筛选的公开发布数据；完整漫画通过经过核实的官方链接前往泰拉记事社阅读。

## 当前状态

这是公开站的 initial commit，尚未包含人物图库、漫画图片、数据库、留言后端或访问统计脚本。没有发布数据时，首页会显示说明文字，不会生成虚构角色、图片或统计数字。

仓库只放站点代码和发布格式说明。私有 SQLite、原始漫画、内建 panel、审核记录、模型和临时导出包不得加入此仓库。生成的发布数据和图像目录已经加入 `.gitignore`。

## 本地预览

需要 Python 3。进入项目目录后运行：

```bash
python3 -m http.server 4173
```

打开 <http://127.0.0.1:4173>。页面通过静态文件服务器加载配置和可选发布清单；直接双击 `index.html` 不适合作为预览方式。

## 目录

```text
index.html          首页、角色／篇目检索、统计和留言入口
about.html          项目介绍、来源和版权说明
privacy.html        隐私与数据说明
styles.css          全站粉丝站视觉样式
app.js              发布清单加载、检索、出处预览和轮播
config/site.json    站名、主题和轮播的初始配置
_headers            Cloudflare Pages 安全响应头
data/               公开发布数据（生成文件默认不进 Git）
media/              公开展示副本（生成文件默认不进 Git）
```

## 发布数据格式

未来由独立的只读导出程序生成 `data/release.json`。字段参考：

```json
{
  "release_id": "2026-09-23-001",
  "generated_at": "2026-09-23T00:00:00Z",
  "overview": {
    "characters": 0,
    "episodes": 0,
    "instances": 0
  },
  "characters": [
    {"id": "stable-id", "name": "阿米娅", "aliases": [], "instance_count": 0, "episode_count": 0}
  ],
  "episodes": [
    {"id": "stable-id", "name": "001_阿米娅篇", "official_url": "https://comic.hypergryph.com/comic/6253", "instance_count": 0}
  ],
  "instances": [
    {"id": "stable-id", "character_id": "stable-id", "episode_id": "stable-id", "crop_url": "/media/crops/example.webp", "source_preview_url": "/media/source-previews/example.webp", "sort_key": "001/01/001"}
  ],
  "featured_instance_ids": []
}
```

以上只有格式示例，计数为零且没有任何漫画图片。示例中的官方链接是系列入口，不可代替每一篇逐条核实后的具体篇目链接。正式导出时，缺少官方对应链接的篇目不应进入发布清单。

人物图只能是筛选过的人物 crop 展示副本；出处预览只能是从其来源原图生成的低清缩略图。不得将原图、内建 panel、绝对路径、标签历史或 embedding 放入发布包。公开图片可被访客保存，不能把访问控制当成版权保护。

## Cloudflare Pages

此仓库可以连接 Cloudflare Pages 的 Git 集成，用静态站点方式部署，根目录和输出目录均为仓库根目录，不需要构建命令。部署前须单独检查发布包，确认没有不应公开的数据或图像。

匿名留言板目前只有关闭状态的界面提示。正式开放前需要单独部署并配置 Pages Function、D1、限流和 Turnstile 服务端校验；不能只启用前端表单，也不能让留言内容写入人物身份数据库。Cloudflare Web Analytics 可在 Pages 控制台单独开启，本仓库没有自建访客跟踪代码。

## 版权与来源

本站是《明日方舟》爱好者制作的非官方粉丝检索站，与鹰角网络不存在官方隶属或代言关系。官方漫画、角色和图片的版权归各自权利人所有。本站原创整理内容采用 CC BY-NC-SA 4.0；此许可不覆盖官方漫画素材、第三方素材或访客留言。完整说明见 [关于本站](about.html)。
