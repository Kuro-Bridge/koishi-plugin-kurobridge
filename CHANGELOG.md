# koishi-plugin-kurobridge

## 0.2.0

### Minor Changes

- feat: 协议依赖 ^0.1.0 → ^0.4.0（npm 包版本轴对齐协议版本轴，^0.1.0 的 0.x 区间接不到 0.4.0）；移除 tsdown alwaysBundle 内联绕行，产物改为运行时 require 协议包（0.4.0 exports 已含 require 条件，ADR-001 阶段 2 / KD-10 结案）；协议线格式零变化；新增包内金样本契约测试（fixtures + validateFixture + SHA256SUMS 完整性，开发面）。

- 连接层 `KurobridgeConnection`（M2）：kurobridge-ws 客户端状态机（子协议握手 / hello-ack 关联 / 应用层心跳 / 感知 close code 的指数退避重连 ±20% 抖动 / 未知帧容忍 / 三类永久停），假服务端测试 12 例。

- 翻译层 `src/translate.ts`（M3 纯函数）：入站 Koishi 元素树降级（text/at/img/face/quote/br/p，音视频文件转发跳过，空白 null 不发）；出站四模板渲染 + § 色码剥离 + UTF-16 截断 + command_result 三态；表驱动测试 28 例。

- Koishi 装配 `src/index.ts`（M5）：Schema 配置面板（url/token/name/client/commandPrefix/ping/四模板/色码剥离/截断），hello 身份运行时解析（KD-03，版本退化 warn），入站 `ctx.on("message")` 挂点 + 自过滤 + 命令分流，游戏事件 `ctx.broadcast` 单频道，dispose 清理；ctx 桩 + 假服务端集成测试 7 例（koishi 以 vi.mock 替身绕开 .yml 运行时依赖）。

- 适配层 `KurobridgeAdapter`（M4 平台无关核心）：绑定集 SSOT 镜像（hello_ack 快照 + bindings_updated 热更）、入站过滤链（绑定/空文本/命令前缀分流/空命令忽略）、command/query 的 UUID pending 关联、四事件渲染分发；全依赖注入不依赖 Koishi，假服务端全链路测试 13 例。

### Patch Changes

- 修复游戏事件广播路由：绑定表频道为裸标识（如 QQ 群号），koishi 的 broadcast 按 `platform:id` 限定匹配频道——改为对每个在线 bot 平台拼 `platform:channel` 后广播（无 bot 时跳过）。真机联调发现（M7：channel not found 警告 + 无出站）。

- 协议依赖接入：从仓内镜像切换到 `@kuro-bridge/protocol@^0.1.0` 真包（KD-09），删除 `src/protocol/` 镜像三件套，`index.ts` 改为包具名 re-export；新增 golden 对表测试锁定发布件线格式（27 例）。

- fix: 补记：无数据库时跳过游戏事件广播并 warn、声明 optional database 服务依赖（fd659b2）；清理 M7-DEBUG 调试日志残留。

- 发版前文档与元数据求真：koishi market 简介替换占位文案、service 补 optional database 声明；readme 新增「安装」小节并更新协议依赖描述（^0.4.0 真实运行时依赖、移除 alwaysBundle 内联）；v0.1 任务书归档标注、NOTES 补记 M7 实录与 KD-12（GitHub 仓转移）。
