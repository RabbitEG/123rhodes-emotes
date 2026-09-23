# 公开发布清单

路径由 config/site.json 的 releaseManifest 指定，默认 /data/release.json；publicDataBaseUrl 指定 R2 公开域名，空值代表当前 origin。本地真实发布包位于被忽略的 publish/site/，GitHub 不保存索引或素材。字段只用于公开检索；不能把 SQLite 导出结果直接当发布清单。

## 必需内容

- characters：`id`、`name`；可选 `aliases: string[]`、`type: "canonical"`，以及 `home_episode_ids: string[]`。本篇关系是角色与篇目的多对多映射；空数组表示当前没有登记本篇。只含已发布的具名角色；不发布 NPC、临时身份、历史错误身份。id 稳定且不含逗号（组合分享链接使用逗号分隔）。
- episodes：`id`、`name`、`official_url`。链接必须核实为对应篇目；系列首页不代替具体篇目。前端仅允许 HTTPS comic.hypergryph.com / terra-historicus.hypergryph.com。
- instances：`id`、`character_id`、`episode_id`、`crop_url`；可选 `image_id`、`source_preview_url`、`sort_key`。每一项是当前有效、人类 confirmed/trusted、经发布筛选的 canonical 实例。
- 三个数组允许为空；重复 ID、未知角色/篇目关联、无效公开资源路径会让清单加载失败并显示重试，防止静默出现错误统计。

crop_url 和 source_preview_url 只接受 `/media/` 下 WebP/PNG/JPEG/AVIF 相对路径。运行时统一加上受配置约束的 R2 公开域名，不允许每张图自行指定外部 URL。人物图保持比例；出处缩略图来自原始整列/整页，不能用后台 panel 代替。禁止任何字段携带本地绝对路径、原图、面板文件、模型/审核历史。

## 可选内容与统计可用性

| 字段 | 用途 |
| --- | --- |
| release_id / generated_at | 发布版本和 UTC 更新时间 |
| images: [{id}] | 发布涉及的源图目录，仅 ID，不带原图地址 |
| overview.images | 无 images 目录时的显式来源图总数 |
| instance.image_id | 两项都缺失时，若每张 crop 都有 image_id，按它去重计来源图数；覆盖不全显示 — |
| characters[].home_episode_ids | 多对多本篇关系；统计还会将篇目标题去掉末尾“篇”后与角色正式名或别名完全相同的篇目视为本篇，并按 `stats.js` 中明确列出的异格篇名映射到同一 canonical character；其余已确认出场才计作客串，不根据一般出场反推本篇。不会使用模糊包含匹配 |
| episode.cast_character_ids / cast_complete | 仅为旧清单兼容字段；新清单优先使用 characters[].home_episode_ids |
| episode.order | 已核实的时间先后顺序数值，所有篇目完整且唯一时启用久未出现榜 |
| featured_instance_ids | 站长选定轮播实例，引用本发布包的 instance id |

四个基础数的篇目/角色/实例直接取相应目录，角色榜和占比来自实际实例，不信任冗余的 instance_count 字段。所有统计只描述同一发布版本。

`order` 不自动从文件名猜测；“相隔 N 篇”是本发布清单中位于最后收录篇目之后的篇目数，不是天数，也不声称官方漫画中一定没有其出场。

导出只映射数据库已记录的 `home_episode`，不根据实际出场反推本篇。未登记本篇的角色，其现有出场全部计作客串；空数组与“已确认此角色没有本篇”遵循当前数据规则。

## 最小格式示意（不是可发布的数据）

```json
{
  "release_id": "release-id",
  "generated_at": "2026-09-23T00:00:00Z",
  "characters": [],
  "episodes": [],
  "instances": [],
  "images": [],
  "cast_complete": false,
  "featured_instance_ids": []
}
```

公开数据与图片不进 Git，用户已选择 R2。Git 驱动 Pages 部署界面和 Functions；media binding 读取私有 bucket 123rhodes-db，publicDataBaseUrl 保持空值，浏览器走同域。上传工具验证每份图片的哈希，先传展示图再传 release.json；详见 R2_SETUP.md。
