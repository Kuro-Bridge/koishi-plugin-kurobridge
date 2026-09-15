# KUROBRIDGE-NOTES —— 执行实录与决策记录

> 对应任务书：[KUROBRIDGE-PROMPT.md](KUROBRIDGE-PROMPT.md)。决策编号 KD-xx，里程碑回填
> M1-xx。本册只增不改（降级/翻案以新条目记录）。

## 决策记录（KD-xx）

- **KD-01（协议依赖形态）**：`@kuro-bridge/protocol` 实测 npm Not Found（2026-09-15，
  registry.npmjs.org 直查；`@kurobridge/protocol` 同样 404；npm 搜索 kurobridge 零包）
  ——KuroAdapter STATUS「已发」表述失实，RENAME 协作清单第 1 项实际未落地。v0.1 采用
  **镜像过渡**（napuketto 同款先例）：`src/protocol/` 只镜像 WS 对端子集，全部 import
  经 `src/protocol/index.ts` 单点转发，SSOT 基线 = KuroAdapter master `17be8f6`；真包
  发布后单文件切换。已列入交付时须向用户明示的事项。
- **KD-02（WS 客户端库）**：`ws`（KuroAdapter 服务端/napuketto 客户端同款），Node/Bun
  双宿主实测可行；不引 koishi 生态 HTTP 客户端。
- **KD-03（对端身份）**：peerId 取 config.name（默认 "koishi"）；platform 固定
  `"koishi"`；version = 插件包版本；client 缺省 `koishi-plugin-kurobridge/<版本>`
  （napuketto 的 client 裸名教训：运行时取版本失败的退化分支要打 warn）。
- **KD-04（绑定表 SSOT）**：完全采纳服务端快照/热更，本插件无频道配置项；空绑定 =
  chat 出站静默跳过、命令不受限（对齐服务端 dispatchCommand）。
- **KD-05（自过滤与防环）**：`session.userId === session.selfId` 跳过（bot 自身消息）。
  多对端同频道的 MC 事件重复投递是部署语义（readme 写明），插件层不做跨对端去重。
- **KD-06（入站挂点）**：`ctx.on("message")` 事件而非 middleware——转发器不应拦截/改写
  指令流水，middleware 语义留给用户自己的指令插件。
- **KD-07（渲染默认值）**：四模板默认对齐 napuketto（`[{player}] {content}` 等）；
  `stripColorCodes` 默认 true（§ 色码在多数聊天端显示为乱码）；`maxMessageLength`
  默认 1500（napuketto 同值，配置化）。
- **KD-08（adapter 平台无关）**：`src/adapter.ts` 不 import koishi（依赖注入回调），
  Koishi 装配只在 `src/index.ts` 薄壳——测试不需 Koishi 运行时。

## 里程碑实录

（执行中回填）
