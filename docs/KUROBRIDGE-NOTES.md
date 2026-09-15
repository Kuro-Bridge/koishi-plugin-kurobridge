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
- **KD-09（协议真包接入，覆盖 KD-01 的过渡形态）**：用户 2026-09-15 晚发布
  `@kuro-bridge/protocol`（KuroAdapter 仓 `bridge/protocol/package.json` 已 bump
  0.1.0，改动在任务书更新时点尚未提交）。任务书已改：新会话第一动作 = 单点切换到
  真包（依赖 ^0.1.0，删镜像三件套，index.ts 改为包具名 re-export）。任务书更新数分钟
  后 npmjs packument 已确认可见（latest 0.1.0，此前 Not Found 为 CDN 负缓存），切换
  应直接成功；镜像三件套（KD-01）作为兜底保留至切换成功后即删。
- **KD-10（协议包 0.1.0 exports 缺 require 条件 → 产物内联绕行）**：M6 构建核验发现
  `@kuro-bridge/protocol@0.1.0` 的 `exports` 只有 `import` 条件（无 `require`/`default`），
  ESM 消费（vitest）正常但 **CJS 产物 require 解析直接失败**（Bun/Node 实测 Cannot find
  module）——Koishi loader 正是 require CJS，属发布阻断。绕行：tsdown `alwaysBundle:
  ["@kuro-bridge/protocol"]` 打进产物（zod/ws 仍 external），构建产物 Bun 下全链路冒烟
  （握手 + token/client 上报 + 版本解析 0.1.0）通过。**KuroAdapter 侧修复项**：
  `bridge/protocol` 发布件补 `require` 条件（或发 CJS 产物 + exports 三态）后重发版，
  本仓即可移除 alwaysBundle 例外。已在 readme 开发者节写明。
- **KD-11（koishi 运行时载入 .yml → 装配测试 vi.mock 替身）**：`@koishi-ce/core` 运行时
  import `.yml` 本地化文件，Bun 原生支持但 vitest 的 Node 运行时不认 → 装配测试
  `vi.mock("koishi")` 注入无操作 Schema 桩（配置声明面）；类型检查仍走真实 koishi 类型
  （`import type`）。同理，**本插件 CJS 产物只能在 Bun 宿主下加载**（Node 加载 koishi
  即炸），冒烟一律用 `bun -e`。


## 里程碑实录

（执行中回填）

- **M2 前置（2026-09-15）**：真包接入一次成功——npmjs packument 可见（latest 0.1.0），
  `bun install` 落在插件局部 `node_modules`（工作区未提升，无影响）；包导出为镜像面
  超集，符号名两侧一致，`src/protocol/index.ts` 原位切换、仓内 import 零改动；镜像
  三件套删除。golden 对表测试新建 `src/protocol/golden.test.ts`（27 例：常量逐字、
  encodeFrame 逐字节、双向 schema 收窄/拒形、方向误用、wsOutboundFrame 全帧集），
  测试放 `src/` 内使 biome+tsc 双覆盖（biome files.includes 只管 `**/src/**`）。
  KD-01 镜像过渡形态就此终结。
- **M2 连接层（2026-09-15）**：`KurobridgeConnection` 状态机 + 假服务端
  （`src/test-support.ts`，复刻 handleProtocols 拒连）12 例：子协议拒连、hello 逐字段、
  token 有无、ping、pong 透传、未知帧三态容忍、退避重连重发 hello（UUID 每次新）、
  hello 超时自断重试、三类永久停、用户 stop 静默。较 napuketto 参考实现新增
  `retryJitter` 参数（任务书要求 ±20% 抖动，napuketto 无抖动；测试传 0 保确定性）。
- **M3 翻译层（2026-09-15）**：纯函数 28 例。坑回填：tsc `noPropertyAccessFromIndexSignature`
  与 biome `useLiteralKeys` 在 Record 字面量 key 访问上规则互斥 → 动态 key 的
  `attrString(el, "id")` 助手同时绕开两侧。
- **M4 适配层（2026-09-15）**：`KurobridgeAdapter` 13 例全链路。queryPending 存
  resolve+reject（stop 时统一 reject，不留悬挂 promise）。
- **M5 装配（2026-09-15）**：`Schema<Config>` 显式注解 + Config 全字段在
  exactOptionalPropertyTypes 下过（M1 坑的预判成立）；`ctx.logger("kurobridge")`
  可调用式（脚手架残迹佐证）；版本解析双路径（`__filename` 优先、import.meta 兜底），
  CJS 产物实测取到 0.1.0。koishi vi.mock 替身见 KD-11。7 例。
- **M6 发版准备（2026-09-15）**：KD-10 产物内联绕行 + Bun 全链路冒烟（假服务端握手，
  token/client/version 实测正确）；readme 补齐（配置表/部署指引/多对端注意/开发者节）；
  changesets 累计 5 条 minor（M2 前置 patch + M2~M5 minor），`changeset status` 待发版
  一并 version。产物 41.2 kB（协议内联后）。
