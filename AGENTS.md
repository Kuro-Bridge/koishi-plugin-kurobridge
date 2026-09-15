# 项目常驻指令

> 本文件是本仓库（koishi-plugin-kurobridge，Koishi 插件）的常驻开发约定。技术栈：TypeScript 7（@typescript/native）+ tsdown + biome + Changesets，开发环境为宿主工作区（external/ 下，依赖由工作区根提升提供，项目内无需 install，包管理器一律 Bun）。

## 基本约束

- **全程使用简体中文**：回复、代码注释、提交说明、文档均用简体中文。
- **参考兄弟项目**：宿主工作区 external/ 下其它插件是现成范式，拿不准的写法先看它们。

## 工作流与门禁

```bash
bun run check        # 门禁：biome check + 类型检查（提交前必跑）
bun run fix          # biome 自动修复 + 类型检查
bun run build        # tsdown 构建，产物 lib/index.cjs（Koishi loader 用 require 加载 CJS）
bun run typecheck    # 仅类型检查
```

- 门禁全绿才提交；逐功能小步提交。
- 新增 locales yml 时参考兄弟项目做法（Bun 运行时原生支持 yml 导入）。

## 代码风格（biome 已强制）

- 4 空格缩进、行宽 100、双引号、尾逗号 all、LF。
- 类型安全：strict 全家桶、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`erasableSyntaxOnly`（禁止 enum 与构造器参数属性，用 const 对象 + 联合类型替代）。
- 类型导入一律 `import type`；相对导入按 NodeNext 带 `.js` 后缀。
- 异步调用必须 await 或显式 void/`.catch`（`noFloatingPromises` 为 error）。

## Changesets 工作流（强制，勿攒）

- 每次用户可见改动随提交在 `.changeset/` 写条目，不要攒到发版前——攒必漏。
- **已知坑**：全新仓库在首次 commit 之前 `changeset status` 会报 "Failed to find where HEAD diverged from <分支>"——先做初始提交即可。
- 手写模板：

  ```md
  ---
  "koishi-plugin-kurobridge": patch
  ---

  fix: ……（简体中文说明）
  ```

- bump 类型（0.x 阶段）：API 破坏 → minor，修复 → patch；纯 chore 不需要。
- 发版：`bun run release`（changeset version → tsdown → npm publish）；发不出先查 `.changeset/` 是否有 pending 条目。

## git 提交流程

1. 先跑门禁确认全绿再提交。
2. `git add -A` 后提交，简体中文提交信息（`feat:` / `fix:` / `docs:` / `chore:`）。
3. 主分支直提；完成后向用户简要说明改动与提交哈希。
