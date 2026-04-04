---
name: skill-advisor
description: >
  分析 skill 生態系健康度並提供改善建議。
  觸發：「分析 skill 健康度」「skill advisor」「skill 健康報告」「analyze skills」「skill health」。
  Use when user wants to audit their skills, reduce token waste, find redundant skills, or improve trigger quality.
  NOT for: 建立或編輯 skill（用 skill-creator）、搜尋 skill 內容。
---

# Skill Advisor

分析 skill 生態系的健康狀態，產出可行動的改善建議。

## 執行流程

### Step 1: 確認掃描範圍

問使用者要分析哪個 skill 目錄：

- **預設**：`~/.claude/skills/`（使用者的全域 skills）
- **指定路徑**：使用者提供的目錄
- **多個來源**：可以跑多次合併結果

如果使用者有 skill-vault（Obsidian vault 專門管理 skill），也問是否要同時產 MOC。

### Step 2: 跑資料收集腳本

用 Bash 工具執行分析腳本。腳本位於本 skill 的 `scripts/` 目錄下。

基本掃描：
```bash
node "{THIS_SKILL_DIR}/scripts/analyze-skills.mjs" --json --dir "{TARGET_DIR}"
```

如果要同時產 MOC（skill-vault 使用者）：
```bash
node "{THIS_SKILL_DIR}/scripts/analyze-skills.mjs" --json --dir "{TARGET_DIR}" --moc "{VAULT_PATH}/skill-map.md"
```

將 JSON 輸出存入變數供後續分析。

### Step 3: 解讀 JSON 數據

解析 JSON 輸出，重點關注：

1. **`summary`** — 總覽數據（totalSkills, orphanRate, avgTriggerScore, totalDescriptionChars, evalCoverage, overlapPairCount, refCoverage）
2. **`skills[].trigger.issues`** — 每個 skill 的問題標籤（tag + message）
3. **`skills[].isOrphan`** — 孤立 skill 標記
4. **`skills[].crossRefs`** / **`skills[].referencedBy`** — 依賴關係圖
5. **`skills[].descriptionLength`** — 各 skill 的 description 長度（用於 token 估算）
6. **`overlaps`** — 功能重疊 pair（skills, commonKeywords, overlapPercent）

### Step 4: [選配] 呼叫 graph-query

如果使用者有 obsidian-graph-query skill 且有 skill-vault，可額外執行：

1. `hubs` 查詢 — 找出被最多 skill 依賴的關鍵節點
2. `bridges` 查詢 — 找出不能隨便砍的 bridge skill
3. `clusters` 查詢 — 找出功能群組分布

將結果合併到分析數據中，用於 Kill List 的安全檢查和 Health Score 的結構指標。

**注意**：此步驟需要 Obsidian 正在運行且 skill-vault 已開啟。如果環境不具備，跳過此步驟，在報告中標註「結構分析未執行（需要 Obsidian + graph-query）」。

### Step 5: 產出建議報告

讀取 `references/health-metrics.md` 了解評分規則和判斷標準。
讀取 `references/advisor-prompt.md` 了解報告格式和分析原則。

根據數據和規則，產出包含以下四個區塊的報告：

1. **Health Score** — 綜合健康分數 0-100，附各指標明細
2. **Kill List** — 建議移除的 skill，附信心度（🔴🟡⚪）和 token 估算
3. **Merge List** — 建議合併的 skill pair，附合併方向和步驟
4. **Fix List** — 建議改善的 skill，附 skill-creator 指令

**關鍵原則**：
- 激進列出，標信心度讓使用者篩選
- 每個建議必須引用具體 JSON 數據
- Kill 和 Merge 必須估算能省多少 token
- Fix List 必須附可執行的行動指令
- Kill List 要檢查 referencedBy，有被引用的降低信心度

### Step 6: 報告交付

將報告以 markdown 格式呈現給使用者。

如果使用者要存檔，建議存到：
- skill-vault 使用者：`{vault}/.config/advisor-report-{YYYY-MM-DD}.md`
- 一般使用者：使用者指定的路徑

## 注意事項

- **不修改任何 SKILL.md**：本 skill 只讀不寫，所有建議由使用者決定是否執行
- **信心度要誠實**：靜態分析有其限制，無法得知使用頻率。低信心就標低信心
- **Token 估算是粗估**：基於 description 字數，實際注入量因 harness 配置而異
- **graph-query 是選配**：Phase 1a 不強制依賴 Obsidian，沒有 graph-query 也能產出有價值的報告
