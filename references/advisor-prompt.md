# Advisor Prompt Template

以下是 skill-advisor 產出建議報告時使用的分析框架。

## 分析流程

1. 讀取 analyze-skills.mjs 的 JSON 輸出
2. 根據 health-metrics.md 的規則計算健康分數
3. 按規則產出 Kill List / Merge List / Fix List
4. 按影響程度排序（token 節省量 > 架構風險 > 品質提升）
5. 為每項建議標註信心度和行動指令

## 報告格式

報告使用以下 markdown 結構：

### Header

# Skill Advisor Report

> 分析時間：{date}
> 掃描路徑：{scanRoot}
> Skill 數量：{totalSkills}

### Health Score 區塊

## Health Score: {score}/100

| 指標 | 數值 | 狀態 |
|------|------|------|
| 孤立率 | {orphanRate}% | {✅ <20% / ⚠️ 20-40% / 🔴 >40%} |
| 功能重疊 | {overlapPairCount} pairs | {✅ 0-1 / ⚠️ 2-3 / 🔴 >3} |
| Eval 覆蓋率 | {evalCoverage}% | {✅ >50% / ⚠️ 20-50% / 🔴 <20%} |
| Trigger 品質 | {avgTriggerScore}/5 | {✅ >3.5 / ⚠️ 2.5-3.5 / 🔴 <2.5} |
| Token 消耗 | {totalDescriptionChars} 字 | {✅/⚠️/🔴 依 skill 數量比例} |
| Reference 覆蓋 | {refCoverage}% | {✅ >50% / ⚠️ 20-50% / 🔴 <20%} |

### Kill List 區塊

## Kill List — 建議移除

每個項目格式：

### {emoji} {skill-name}（{信心度}）
- **原因**：{具體引用 JSON 數據的理由}
- **省 token**：~{descriptionLength} 字/session
- **影響**：{referencedBy 列表，或「無，此 skill 為孤立」}
- **行動**：移除 skill 目錄，或移至 inactive/ 備份

emoji: 🔴=高信心, 🟡=中信心, ⚪=低信心

### Merge List 區塊

## Merge List — 建議合併

### {emoji} {skill-a} ↔ {skill-b}（重疊 {percent}%）
- **方向**：建議將 {trigger 較低的} 併入 {trigger 較高的}
- **理由**：{共同關鍵字、共享依賴}
- **省 token**：~{被合併方的 descriptionLength} 字/session
- **步驟**（高信心項目附具體步驟）：
  1. 將 {skill-a} 的核心邏輯搬入 {skill-b}
  2. 更新 {skill-b} 的 trigger description
  3. 跑 eval 驗證：`/skill-creator run-eval {skill-b}`
  4. 確認無問題後移除 {skill-a}

### Fix List 區塊

## Fix List — 建議改善

### {skill-name} — {issue summary}
- **信心度**：{emoji}
- **問題**：{具體描述，引用 issue tag}
- **行動**：`/skill-creator improve-description {skill-name}` 或具體修改建議
- **預估效果**：{例如「trigger 分數預期從 2/5 提升到 4/5」}

## 分析原則

1. **激進列出，標信心度**：寧可多列一個 ⚪ 低信心的建議，也不要漏掉一個該處理的問題
2. **數據先行**：每個建議必須引用具體的 JSON 數據（「重疊度 47%」而非「重疊度高」）
3. **Token 量化**：Kill 和 Merge 建議必須估算能省多少 token（用 descriptionLength）
4. **行動導向**：Fix List 的每個建議必須附可執行的指令
5. **安全優先**：Kill List 要考慮該 skill 是否被其他 skill 引用（referencedBy），有引用的降低信心度
6. **排序邏輯**：同一個 List 內，🔴 排最前，⚪ 排最後。同信心度按 token 節省量排序
