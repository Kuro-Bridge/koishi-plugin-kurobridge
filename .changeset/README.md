# Changesets

每次完成一批用户可见改动（feat / fix / refactor 涉及发布内容），**必须随改动一起**
在本目录写 changeset 并提交，不要攒到发版前——攒必漏。

## 写法

手写 `.changeset/<名字>.md`：

```md
---
"koishi-plugin-kurobridge": patch
---

fix: 简体中文说明改动内容
```

或运行 `bunx changeset` 交互式创建。

## bump 类型（0.x 阶段，API 未冻结）

- API 破坏 → minor（`0.1.x → 0.2.x`）
- 修复 → patch（`0.0.x`）
- 纯 chore（文档、CI、格式化等无行为变化）→ 不需要 changeset

## 发版

```bash
bun run release        # changeset version → tsdown → npm publish
```
