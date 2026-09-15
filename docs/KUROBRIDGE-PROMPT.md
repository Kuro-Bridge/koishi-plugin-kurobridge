# KUROBRIDGE-PROMPT —— koishi-plugin-kurobridge v0.1 任务书

> 执行者先读本仓 `AGENTS.md` → 本册 → KuroAdapter `docs/protocol/peer-guide.md`（对端契约）。
> 执行模式：无人值守。不提问；决策记 `docs/KUROBRIDGE-NOTES.md`（编号 KD-xx）；单点卡住
> 30 分钟即降级记录并绕行。每完成一个模块跑 `bun run check`。主分支直提，提交必带 changeset。

## 项目定位

Koishi v4 插件 = `kurobridge-ws` 的**官方参考对端**（WS 客户端角色，主动连入 MC 侧
KuroBridge 服务端）+ **平台渲染唯一归属**（MC ↔ 聊天平台的富文本/颜色码/长度收敛只出现在
本仓）。ADR-018。姊妹参考实现：NapukettoQQ `packages/adapter/src/kurobot/`（同为 WS 客户端，
QQ 协议侧；连接状态机/测试模式可借鉴，但本仓用 Koishi 的元素树与会话模型）。

## 硬性约束

1. **协议以 KuroAdapter `bridge/protocol`（0.4.0）为 SSOT**：常量、帧形状、close code
   语义一律对表 SSOT，发现文档与代码漂移以代码为准。**`@kuro-bridge/protocol` 已发布**
   （用户 2026-09-15 晚发版，仓内 `bridge/protocol/package.json` 已 bump 0.1.0）→
   依赖真包，**禁用镜像直探**：M1 曾落过 `src/protocol/` 过渡镜像（KD-01），新会话
   第一动作 = 执行单点切换（见 M2 前置步骤），切换后镜像文件删除、golden 对表测试
   保留（对象改为包导出）。
2. **连接语义对齐 peer-guide**：子协议 `kurobridge-ws.v1` 必带；升级后 10s 内 hello；
   close 1002/1008 与 hello_ack ok:false = 永久停止；1001/1006/网络错误 = 指数退避重连
   （1s 起 ×2 封顶 30s，±20% 抖动）；应用层 ping（服务端 30s 空闲只认应用层入帧）；
   服务端关服 close 1001。hello 字段 peerId/platform/version/protocolVersion 必填，
   token 非空才带，client 可选自报。
3. **绑定表 SSOT 在服务端**：hello_ack `channelBindings` 快照 + `bindings_updated`
   全量热更，本插件不自配频道列表；空绑定 = 不出站任何 chat（命令除外，语义对齐
   服务端 dispatchCommand 不做绑定过滤）。
4. **平台渲染只在本仓**：Koishi 元素树 → 降级文本（发往 MC）与 MC 事件 → 模板渲染 +
   `§` 色码剥离 + 长度收敛（发往平台）。
5. 工程约定从脚手架：Bun、biome（4 空格/行宽 100/双引号/LF）、tsdown CJS、
   `bun run check` 为门禁、Changesets 随提交。类型安全对齐 KuroAdapter 仓风格
   （strict 全家桶已在 tsconfig；禁 `any`，`noFloatingPromises` error）。

## 实现顺序

### M1 工程基座（✅ 已完成并提交——新会话从 M2 起步，勿重做）
已完成内容：根 `bun install`（528 包）；插件 deps（ws、zod）+ devDeps（@types/ws、
vitest）+ `test` script；协议镜像 `src/protocol/` 四件套（SSOT 基线 `17be8f6`，
KD-01 单点出口）；biome 迁移 2.5.13；门禁绿。见 `git log` 首两条提交。
注：镜像在 M1 时是过渡形态，`@kuro-bridge/protocol` 随后已发布——按下方「M2 前置」
执行单点切换。

### M2 前置：协议单点切换（新会话的第一个动作）
1. 插件加依赖 `"@kuro-bridge/protocol": "^0.1.0"`（KuroAdapter 仓
   `bridge/protocol/package.json` 已 bump 0.1.0）→ koishi-dev 根 `bun install`。
   **装不上 = 发版未生效/registry 可见性问题：保留 M1 镜像照常推进全部模块，
   KD-09 记录，最终报告置顶提醒用户核实 publish 输出**；装得上 = 走 2。
2. 切换：删除 `src/protocol/meta.ts`、`frame.ts`、`ws.ts`；`src/protocol/index.ts`
   改为从 `@kuro-bridge/protocol` 具名 re-export（符号名两侧一致，仓内其余 import
   零改动）；本仓代码仍一律经 `src/protocol/index.js` 导入（保持切换面收敛）。
3. golden 对表测试保留（对象 = 包导出的 encodeFrame/schema 线格式），`bun run check`
   绿后提交（changeset 说明依赖接入）。

### M2 连接层 `src/connection.ts`
状态机 `idle → connecting → establishing → established ↔ backoff → stopped`：
`new WebSocket(url, WS_SUBPROTOCOL)`；open 即发 hello（UUID，超时 10s 自断走重试）；
hello_ack 按 id 关联，ok → established + 启动 ping；ok:false / close 1002 / 1008 →
永久停止回调；其余 → 退避重连（重连重发 hello，UUID 每次新）；用户 stop() 静默。
未 established 时 send 丢弃返回 false，不积压。未知事件帧忽略、未知请求帧回
`<type>_result` 失败回执、`_result` 结尾不回执防乒乓。
**测试**：假服务端（复刻子协议校验 + 可注入应答 + 收帧记录，参照 napuketto
test-support 模式自写），FAST 参数注入，覆盖：子协议拒连、hello 逐字段对表、
token 有无、ping/pong 透传、重连重发 hello、三类永久停、用户 stop、未知帧容忍。

### M3 翻译层 `src/translate.ts`（纯函数）
- 入站方向（平台→MC）：Koishi 元素**树**降级——`text`→content、`at`→`@名字或id`
  （all→`@全体成员`）、`img`/`image`→`[图片]`、`face`→`[表情]`、`quote`/`reply`→
  `[回复]`、`br`→换行、`p`→递归 children、音视频文件转发类静默跳过；join+trim，
  空串返回 null=不发。
- 出站方向（MC→平台）：四模板（chat/join/leave/death，占位符 `{player}/{content}/
  {message}`，缺省变量代空串，未知占位符原样保留）；death message 空串以「死亡了」
  代入；`§` 色码剥离（`§[0-9a-fk-or]`，配置开关）；`maxMessageLength` 截断（默认
  1500，UTF-16 码元，超长加「…(截断)」）。
- 命令结果渲染：ok:false→`命令失败：<error>`；output 空→`（命令执行成功，无输出）`；
  否则 join("\n")（同样过截断）。
**测试**：表驱动纯函数用例。

### M4 适配层 `src/adapter.ts`（平台无关核心）
持有 connection + 绑定集状态 + 命令 pending 表（UUID→channel），通过回调接口向宿主
暴露：`onLog(level,msg)`、`onGameEvent(type,rendered,channel)`（宿主负责广播到平台）、
`onStatus(status)`；提供宿主调用面：`forwardChat(channel,sender,elements)`（绑定过滤 +
降级 + chat 帧）、`forwardCommand(channel,userId,command)`（pending 登记 + command 帧，
**不做绑定过滤**）、`query(kind)`、`stop()`。hello_ack 快照与 bindings_updated 热更
绑定集；command_result 渲染后经 onGameEvent 回宿主。全部依赖注入（logger/宿主回调），
不 import koishi——保证可独立测。
**测试**：假服务端全链路：入站过滤链（绑定/空文本/命令分流/空命令忽略）、
command_result 三态渲染、服务端四事件模板渲染 + § 剥离 + 截断、bindings 热更。

### M5 Koishi 装配 `src/index.ts`
`Config = Schema.object(...)`：url（必填）、token（默认 ""）、name（peerId，默认
"koishi"）、client（缺省运行时算 `koishi-plugin-kurobridge/<版本>`）、commandPrefix
（默认 "/"）、pingIntervalMs（15000）、四模板（默认值对齐 napuketto）、
stripColorCodes（true）、maxMessageLength（1500）。
`apply`：组装 adapter（ctx.logger 接 onLog）；入站 `ctx.on("message")`：channelId ∈
绑定集 + `session.userId !== session.selfId` 自过滤 + 前缀分流；sender 取
`session.username ?? session.userId`；游戏事件 → `ctx.broadcast([...bindings], 文本)`
（仅当绑定非空）；`ctx.on("dispose")` → adapter.stop()。
**测试**：轻量 ctx 桩（收集 broadcast 调用）+ 假服务端集成用例。

### M6 文档与发版准备
readme 补齐（简介/配置表/部署指引指向 peer-guide/与 MC 侧的对接步骤）；changeset
（minor：初始功能集）；`bun run build` 产物核验（lib/index.cjs + .d.ts，CJS）。

### M7 真机联调（KuroAdapter 沙盒）
MC 侧沙盒服在跑（ws://127.0.0.1:25580，token `kurobridge-sandbox-token`，napuketto
对端已在线——多对端并存是设计语义）。koishi-dev 根安装后 koishi.yml 挂
`kurobridge` 插件条目 → 后台 `bun start` → 验四点：①握手成功日志 + bindings 快照
`["967493177"]`；②status 查询通路（日志或调试）；③注入一条平台消息（mock/沙盒）→
KuroAdapter `console.log` 出现 `<sender> content` broadcast；④KuroAdapter 沙盒
fake-player 或控制台触发 join/chat → 插件日志出现广播调用。结束后 koishi.yml 还原
为注释态并入 NOTES。

## 验收清单

1. `bun run check` / `bun run test`（三层测试全绿）/ `bun run build` 全绿。
2. 连接层覆盖 peer-guide 关闭策略全分支（1002/1008 永久停、1001/1006 重连、用户 stop）。
3. golden 帧对表：镜像帧线格式与 KuroAdapter SSOT 0.4.0 逐字节一致（对表基线 `17be8f6`）。
4. M7 四点实测过。
5. 禁 `any`；提交全带 changeset；KD 决策全部记 NOTES。
6. 全程未 push 远端以外泄凭据（本地提交即可；push 结果如实记录）。

## 踩坑传递（前仓实录 + 本仓开工实测）

- Bun 工作区：external 插件依赖由根提升，**必须先在 koishi-dev 根 bun install**（M1 已装）。
- **本仓无 pre-commit 钩子**：门禁不会拦提交，每次提交前手动 `bun run check`（M1 曾因此
  把红门禁提交进去，靠 amend 补救）。
- 脚手架坑（M1 实测，已修复但同类问题会再现）：biome.json schema 版本落后于装到的
  biome CLI → `bunx biome migrate --write`；biome `organizeImports` 连 **export 列表的
  排序**也管（`--write` 可修）；`Schema<Config>` 显式注解在 exactOptionalPropertyTypes
  下对空 object 会炸 TS2375——用推断（不注解）或给 Config 全字段。
- `koishi` import 实为 `@koishi-ce/koishi-shim@4.18.11`（peerDeps 已配好，直接
  `import {} from "koishi"`）。
- death 帧字段名是 `player`/`message`，与 join/leave 的 `playerName` 不一致——照抄
  SSOT 不「修正」；status 帧无 channel；command_result 的 output 可选。
- 服务端 30s 空闲只认应用层帧：ping 间隔必须显著小于 30s（缺省 15s）。
- 登录历史同步类竞态（napuketto 实录）：握手完成前的入站消息会被丢弃，测试断言要在
  established 之后。
- Windows 沙盒：Git Bash 双引号路径尾反斜杠吃闭引号；长驻进程用 run_in_background。
- 多对端同频道 = MC 事件重复投递（设计语义，部署注意事项，写进 readme）。
- 真包发布前镜像只能以 golden 对表锁漂移——KuroAdapter 侧 protocol 改动须人工同步
  （在 readme 开发者节写明）。
