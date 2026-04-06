---
name: skill-advisor
description: >
  Skill 衛生工具：分析已安裝的 skill 生態系，找出重疊、衝突、可刪除、可精簡的 skill，
  用互動式 Action Cards 引導使用者逐一清理。
  觸發：「分析 skill」「skill 清理」「skill advisor」「analyze skills」「skill health」
  「太多 skill 了」「整理 skill」「skill 去重」。
  Use when user has accumulated many skills and wants to optimize their skill collection.
  Make sure to use this skill whenever the user mentions skill management, cleanup,
  or when they're confused about which skill does what.
  NOT for: 建立或編輯單個 skill（用 skill-creator）。
---

# Skill Advisor — Skill 衛生工具

分析已安裝的所有 skill，用語意分析找出重疊和冗餘，產出 Action Cards 引導使用者逐一清理。

## 執行流程

### Step 1: 跑資料收集腳本

掃描所有已安裝的 skill：

```bash
node "{THIS_SKILL_DIR}/scripts/analyze-skills.mjs" --json --dir "{HOME}/.claude/skills"
```

如果使用者有專案級 skill，也一起掃：

```bash
node "{THIS_SKILL_DIR}/scripts/analyze-skills.mjs" --json --dir ".claude/skills"
```

合併兩次的 JSON 結果。

### Step 2: 派 subagent 做語意分析

派一個 Sonnet subagent，傳入：
- 所有 skill 的 name + description 全文
- 依賴圖（skillRefs、referencedBy）
- 孤兒標記

請 subagent 分析並回傳 JSON：

```json
{
  "actions": [
    {
      "type": "merge | remove | trim | conflict",
      "skills": ["skill-a", "skill-b"],
      "reason": "具體原因",
      "suggestion": "具體建議動作",
      "token_save_estimate": 400
    }
  ]
}
```

分析任務：
1. **語意重疊（merge）** — 哪些 skill 功能實質重疊，做的事一樣
2. **觸發衝突（conflict）** — 哪些 skill 會對同一種 prompt 搶觸發
3. **可刪除（remove）** — 哪些 skill 功能已被其他 skill 完全涵蓋，且無人引用
4. **Token 肥大（trim）** — 哪些 description 可以精簡但不影響觸發

subagent prompt 要點：
- 不要只看關鍵字，要理解每個 skill 實際做什麼
- 考慮依賴關係：被其他 skill 引用的不建議刪除
- 每個建議必須附具體理由和行動
- 用繁體中文

### Step 3: 產出 Action Cards 並逐一互動

將 actions 按 token_save_estimate 由大到小排序。

逐一呈現 Action Card：

```
📋 Action Card [N/total]：[type 中文名]

[skill name(s)]
原因：[reason]
建議：[suggestion]
預估省 token：~[token_save_estimate] 字

→ 接受 / 跳過 / 修改？
```

type 中文對照：
- merge → 去重
- remove → 移除
- trim → 精簡
- conflict → 衝突

### Step 4: 執行被接受的修改

根據使用者的決定：

- **接受 remove**：將 skill 目錄移至 `~/.claude/skills/_inactive/`（備份，不是真刪）
- **接受 merge**：修改兩個 skill 的 description，明確分工界線
- **接受 trim**：精簡 description，保留觸發能力
- **接受 conflict**：在兩個 skill 的 description 加入 disambiguation（NOT for 語句）
- **修改**：使用者給方向，Claude 調整後執行

每執行一個修改後，告知使用者完成，再呈現下一張 Card。

### Step 5: 總結

全部 Card 過完後，呈現總結：

```
✅ 完成 skill 清理

執行了 N/M 項建議
移除：X 個 skill（已備份至 _inactive/）
精簡：Y 個 description
解決衝突：Z 個
預估省 token：~W 字/session
```

## 注意事項

- **不直接刪除 skill**：移除操作是搬到 _inactive/ 備份，使用者可隨時搬回來
- **語意分析用 Sonnet**：需要理解力判斷重疊，Haiku 不夠
- **不改 skill 的功能邏輯**：只改 description 和 trigger，不碰 SKILL.md body
- **使用者有最終決定權**：每個修改都要使用者確認
