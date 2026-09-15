---
"koishi-plugin-kurobridge": minor
---

适配层 `KurobridgeAdapter`（M4 平台无关核心）：绑定集 SSOT 镜像（hello_ack 快照 + bindings_updated 热更）、入站过滤链（绑定/空文本/命令前缀分流/空命令忽略）、command/query 的 UUID pending 关联、四事件渲染分发；全依赖注入不依赖 Koishi，假服务端全链路测试 13 例。
