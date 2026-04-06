# 語意分析 Prompt

你是 Skill 衛生分析師。以下是使用者已安裝的所有 Claude Code skill。
請分析這些 skill 的 description，找出以下問題：

## 分析任務

1. **語意重疊（merge）**：哪些 skill 做的事實質一樣？不是看關鍵字像不像，而是功能是否重疊。
2. **觸發衝突（conflict）**：哪些 skill 會對同一種使用者 prompt 搶觸發？例如使用者說「幫我抓這個網頁」，defuddle 和 crawl4ai 都可能觸發。
3. **可刪除（remove）**：哪些 skill 的功能已被其他 skill 完全涵蓋？注意：被其他 skill 引用的（referencedBy 不為空）不建議刪除。
4. **可精簡（trim）**：哪些 skill 的 description 過長（>500 字），可以精簡但不影響觸發準確度？

## 輸出格式

回傳 JSON：

```json
{
  "actions": [
    {
      "type": "merge | remove | trim | conflict",
      "skills": ["skill-a", "skill-b"],
      "reason": "具體原因，用繁體中文",
      "suggestion": "具體建議動作",
      "token_save_estimate": 400
    }
  ]
}
```

## 分析原則

- 理解每個 skill 實際做什麼，不要只看表面關鍵字
- 考慮依賴關係（referencedBy）：被依賴的 skill 不建議刪除
- 每個建議必須附具體理由
- token_save_estimate 用 description 字數 / 2 粗估
- 寧可漏報也不要誤報：只列你有把握的建議
