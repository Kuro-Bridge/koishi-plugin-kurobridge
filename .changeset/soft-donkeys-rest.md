---
"koishi-plugin-kurobridge": minor
---

Koishi 装配 `src/index.ts`（M5）：Schema 配置面板（url/token/name/client/commandPrefix/ping/四模板/色码剥离/截断），hello 身份运行时解析（KD-03，版本退化 warn），入站 `ctx.on("message")` 挂点 + 自过滤 + 命令分流，游戏事件 `ctx.broadcast` 单频道，dispose 清理；ctx 桩 + 假服务端集成测试 7 例（koishi 以 vi.mock 替身绕开 .yml 运行时依赖）。
