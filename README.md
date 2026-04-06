# Skill Advisor

分析 Claude Code skill 生態系的健康狀態，產出可行動的改善建議。

## 功能

- **Health Score** — 綜合健康分數 0-100，涵蓋孤立率、功能重疊、Eval 覆蓋率、Trigger 品質、Token 效率、Reference 覆蓋率
- **Kill List** — 建議移除的 skill，附信心度和 token 節省估算
- **Merge List** — 建議合併的 skill pair，附合併方向和步驟
- **Fix List** — 建議改善的 skill，附可執行的行動指令
- **MOC 產出**（選配）— 為 Obsidian skill-vault 產出 skill-map.md

## 安裝

將此 skill 放進 Claude Code 的 skills 目錄：

```bash
# 複製到全域 skills
cp -r skill-advisor ~/.claude/skills/

# 或複製到專案 skills
cp -r skill-advisor .claude/skills/
```

## 使用

在 Claude Code 對話中觸發：

```
分析 skill 健康度
skill advisor
analyze skills
skill health
```

Claude 會執行分析腳本，解讀數據，產出建議報告。

## 運作原理

### 1. 資料收集

`scripts/analyze-skills.mjs` 掃描 skill 目錄，從每個 SKILL.md 萃取：

- Frontmatter（name、description）
- Trigger 品質評分（0-5）
- 跨 skill 引用和依賴關係
- 功能重疊偵測（基於關鍵字共現）
- Eval 和 Reference 覆蓋率

```bash
# 基本掃描
node scripts/analyze-skills.mjs --json --dir ~/.claude/skills/

# 同時產 MOC（skill-vault 使用者）
node scripts/analyze-skills.mjs --json --dir ~/.claude/skills/ --moc /path/to/vault/skill-map.md
```

支援兩種目錄結構：
- **扁平結構**：`dir/skill-a/SKILL.md`
- **分組結構**：`dir/group/skill-a/SKILL.md`

### 2. LLM 分析

Claude 根據 `references/health-metrics.md` 的評分規則解讀 JSON 數據，產出四區塊報告。

### 3. 選配：Graph 分析

如果有 Obsidian skill-vault + obsidian-graph-query，可額外執行結構分析（cluster 分布、bridge 密度、爆炸半徑），合併到報告中。

## 健康指標

| 指標 | 健康範圍 | 不健康範圍 | 權重 |
|------|---------|-----------|------|
| 孤立率 | <20% | >40% | 15% |
| 功能重疊 | 0-1 pair | >3 pairs | 15% |
| Eval 覆蓋率 | >50% | <20% | 20% |
| Trigger 品質 | >3.5/5 | <2.5/5 | 20% |
| Token 效率 | <5000 chars/10 skills | >10000 | 15% |
| Reference 覆蓋率 | >50% | <20% | 15% |

## 檔案結構

```
skill-advisor/
├── SKILL.md              # Skill 定義（觸發條件、執行流程）
├── scripts/
│   ├── analyze-skills.mjs  # 資料收集腳本
│   └── test-analyze.mjs    # 測試腳本
├── references/
│   ├── health-metrics.md   # 健康指標定義和評分規則
│   └── advisor-prompt.md   # 報告格式和分析原則
└── evals/                  # 測試案例
```

## 背景

此專案源自 [skill-vault](https://github.com/azuma520/skill-advisor/issues) 的構想——用 Obsidian 視覺化 skill 架構，搭配健康度分析腳本，讓 skill 生態系的管理從「能看到」升級到「能指導行動」。

## 注意事項

- **唯讀分析**：不會修改任何 SKILL.md，所有建議由使用者決定是否執行
- **靜態分析的限制**：無法得知 skill 的實際使用頻率，低信心就標低信心
- **Token 估算是粗估**：基於 description 字數，實際注入量因 harness 配置而異

## License

MIT
