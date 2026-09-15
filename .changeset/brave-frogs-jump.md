---
"koishi-plugin-kurobridge": patch
---

修复游戏事件广播路由：绑定表频道为裸标识（如 QQ 群号），koishi 的 broadcast 按 `platform:id` 限定匹配频道——改为对每个在线 bot 平台拼 `platform:channel` 后广播（无 bot 时跳过）。真机联调发现（M7：channel not found 警告 + 无出站）。
