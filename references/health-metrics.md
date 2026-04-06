# Health Metrics — 健康指標定義

本文件定義 Skill Advisor 的健康評分框架。LLM 顧問根據此框架解讀 analyze-skills.mjs 的 JSON 輸出。

## 綜合健康分數（0-100）

### Phase 1a 指標（靜態分析）

| 指標 | JSON 路徑 | 健康範圍 | 不健康範圍 | 權重 |
|------|-----------|---------|-----------|------|
| 孤立率 | summary.orphanRate | <20% | >40% | 15% |
| 語意重疊 | 語意分析判定 | 0-1 pair | >3 pairs | 15% |
| Eval 覆蓋率 | summary.evalCoverage | >50% | <20% | 20% |
| 平均 Trigger 品質 | summary.avgTriggerScore | >3.5/5 | <2.5/5 | 20% |
| Token 效率 | summary.totalDescriptionChars | <5000 (per 10 skills) | >10000 (per 10 skills) | 15% |
| Reference 覆蓋率 | summary.refCoverage | >50% | <20% | 15% |

### Phase 1b 指標（graph-query，待驗證）

| 指標 | 來源 | 健康範圍 | 不健康範圍 |
|------|------|---------|-----------|
| Cluster 分布 | graph-query: clusters | 3-8 個清晰群組 | 1 個巨大 cluster 或全部孤立 |
| Bridge 密度 | graph-query: bridges | <20% of skills | >40% of skills |
| 爆炸半徑 | graph-query: neighbors | max 2-hop < 50% of total | max 2-hop > 80% of total |

## Kill List 判斷規則

一個 skill 進入 Kill List 需要滿足以下條件的加權組合：

| 條件 | 權重 | 信心度貢獻 |
|------|------|-----------|
| 是孤立 skill（isOrphan = true） | 高 | +🔴 |
| Trigger 分數 ≤ 2/5 | 中 | +🟡 |
| 功能被其他 skill 覆蓋（語意分析判定） | 高 | +🔴 |
| 無 eval 且無 reference | 中 | +🟡 |
| description 過短（<50 字） | 低 | +⚪ |
| [Phase 1b] 不是 bridge | 安全檢查 | 降低誤殺風險 |

信心度：🔴高（3+ 條件命中）、🟡中（2 條件）、⚪低（1 條件但值得關注）

## Merge List 判斷規則

兩個 skill 進入 Merge List 需要：

| 條件 | 必要/加分 |
|------|----------|
| 功能實質重疊（語意分析判定） | 必要 |
| 共享 CLI 依賴 | 加分 |
| 同一個 group | 加分 |
| [Phase 1b] 在同一個 cluster | 加分 |

合併方向建議：保留 trigger 分數較高的那個作為主體。

## Fix List 判斷規則

| 問題 | 對應 issue tag | 行動 |
|------|---------------|------|
| Trigger 缺中文 | no-chinese | 加中文觸發詞 |
| Trigger 不夠 pushy | not-pushy | 加 "Use when" / "Make sure" 語句 |
| Description 過長 | too-long | 精簡到 500 字以內 |
| Description 過短 | too-short | 補充使用場景和觸發條件 |
| 缺反向排除 | no-disambiguation | 加 "NOT for" 語句 |
| 無 eval | hasEvals = false | 用 skill-creator 建 trigger-eval.json |
| 無 reference | hasRefs = false | 考慮是否需要補充參考文件 |

Fix List 的行動指令格式：
- Trigger 優化：`/skill-creator improve-description <skill-name>`
- 建 eval：`/skill-creator create-eval <skill-name>`
- 跑 eval：`/skill-creator run-eval <skill-name>`
