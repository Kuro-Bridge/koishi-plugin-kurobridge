---
"koishi-plugin-kurobridge": patch
---

协议依赖接入：从仓内镜像切换到 `@kuro-bridge/protocol@^0.1.0` 真包（KD-09），删除 `src/protocol/` 镜像三件套，`index.ts` 改为包具名 re-export；新增 golden 对表测试锁定发布件线格式（27 例）。
