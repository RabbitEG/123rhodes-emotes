# Canonical character name reconciliation

The public release can contain separate rows for alter operators when the source character database has not yet merged them. The site folds these rows into the earlier-implemented base operator at read time, including instances, episode cast references, aliases, and operator-form records. This compatibility layer does not write to `character_index` or change its human labels/history.

| Current canonical row to merge | Earlier canonical row to keep | Current public IDs | Current crops on alias row |
| --- | --- | --- | ---: |
| 维娜·维多利亚 | 推进之王 | `60ae5aa63d1a0fbc` → `d02df707d241b8fb` | 17 |
| 酒神 | 傀影 | `a2c0878923815ac9` → `cf34a85641597783` | 13 |
| 焰狐龙梓兰 | 梓兰 | `adf77042f1b6fce4` → `0c745df014c70d55` | 0 |
| 雷狼龙S空爆 | 空爆 | `bd0ccb3a8c8eb5df` → `e9d3e19934919550` | 0 |

When reconciling the private database, merge each source identity into the target identity rather than merely renaming both rows to the same text. Reassign confirmed instances and episode-cast references while retaining label/event provenance; store these official alter names as operator forms, not player aliases. Targets are selected because their base forms were implemented earlier: 推进之王 (2019-04-30) before 维娜·维多利亚 (2024-10-09), 傀影 (2020-04-21) before 酒神 (2025-06-05), 梓兰 (2019-04-30) before 焰狐龙梓兰 (2026-06-01), and 空爆 (2019-05-23) before 雷狼龙S空爆 (2026-06-01).

PRTS identifies [焰狐龙梓兰](https://prts.wiki/w/%E7%84%B0%E7%8B%90%E9%BE%99%E6%A2%93%E5%85%B0) and [雷狼龙S空爆](https://prts.wiki/w/%E9%9B%B7%E7%8B%BC%E9%BE%99S%E7%A9%BA%E7%88%86) as alter operators. Other reviewed alter-form names are already represented as forms of their earlier canonical character in the public site and do not require a separate row mapping here.
