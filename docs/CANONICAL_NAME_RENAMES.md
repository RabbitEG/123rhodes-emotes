# Canonical character name reconciliation

The public release currently contains two alter-only character rows whose earlier base-operator rows should remain the canonical entries. The site now folds the alter rows into those canonical entries at read time, including instances, episode cast references, and operator-form records. This is a compatibility layer only; it does not write to `character_index` or change its human labels/history.

| Current canonical row to merge | Earlier canonical row to keep | Current public IDs | Current crops on alias row |
| --- | --- | --- | ---: |
| 维娜·维多利亚 | 推进之王 | `60ae5aa63d1a0fbc` → `d02df707d241b8fb` | 17 |
| 酒神 | 傀影 | `a2c0878923815ac9` → `cf34a85641597783` | 13 |

When reconciling the private database, merge each source identity into the target identity rather than merely renaming both rows to the same text. Reassign its confirmed instances and episode-cast references while retaining label/event provenance, then keep the former name as an alias. The target is selected because its base form has the earlier implementation date: 推进之王 (2019-04-30) before 维娜·维多利亚 (2024-10-09), and 傀影 (2020-04-21) before 酒神 (2025-06-05).

Other reviewed alter-form names are already represented as aliases of their earlier canonical character in the public site and do not require a separate canonical-row rename in the current release.
