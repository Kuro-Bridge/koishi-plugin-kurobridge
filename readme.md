# koishi-plugin-kurobridge

[![npm](https://img.shields.io/npm/v/koishi-plugin-kurobridge?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-kurobridge)

[kurobridge-ws](https://github.com/Kuro-Bridge/KuroAdapter) 协议的 **Koishi v4 官方参考对端**：
把 Koishi 接入的聊天平台（QQ 等）与 Minecraft 服务器双向互通——群聊 ↔ 游戏内聊天、
群指令 → 服务器命令、进服/退服/死亡/状态事件广播回群。

- **角色**：本插件是 WS **客户端**，主动连入 MC 侧 KuroBridge 服务端（`kurobridge-ws.v1`），
  不监听任何端口；绑定哪些频道（群）由 MC 服主配置决定（SSOT 在服务端）。
- **协议**：帧定义以 [@kuro-bridge/protocol](https://www.npmjs.com/package/@kuro-bridge/protocol)
  （0.4.0）为唯一来源；连接语义（握手/心跳/关闭策略）对表
  [peer-guide](https://github.com/Kuro-Bridge/KuroAdapter/blob/master/docs/protocol/peer-guide.md)。

## 配置

| 配置项 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `url` | string | **必填** | KuroBridge 服务端地址（`ws://` / `wss://`） |
| `token` | string | `""` | 鉴权 token；MC 侧配置了非空 token 时必须一致，否则连接被拒（close 1008，不重连） |
| `name` | string | `"koishi"` | 对端实例标识（hello.peerId，服务端日志辨识用） |
| `client` | string | 运行时算 | 自报身份串，缺省 `koishi-plugin-kurobridge/<版本>` |
| `commandPrefix` | string | `"/"` | 消息以该前缀开头 → 作为服务器命令发送（如 `/whitelist list`），否则进游戏聊天 |
| `pingIntervalMs` | number | `15000` | 应用层心跳间隔（服务端空闲阈值 30s，须显著小于） |
| `chatTemplate` | string | `"[{player}] {content}"` | 游戏聊天渲染模板 |
| `joinTemplate` | string | `"{player} 加入了服务器"` | 进服模板 |
| `leaveTemplate` | string | `"{player} 离开了服务器"` | 退服模板 |
| `deathTemplate` | string | `"{player} {message}"` | 死亡模板（死亡消息为空时以「死亡了」代入） |
| `stripColorCodes` | boolean | `true` | 剥离 `§` 颜色代码（多数聊天端显示为乱码） |
| `maxMessageLength` | number | `1500` | 出站文本长度上限（UTF-16 码元，超长截断加「…(截断)」） |

模板占位符：`{player}` / `{content}` / `{message}`；缺省变量代空串，未知占位符原样保留。

## 安装

- Koishi 市场搜索 `kurobridge` 一键安装；
- 或手动安装：`npm i koishi-plugin-kurobridge`。

协议包 `@kuro-bridge/protocol` 会作为本插件的运行时依赖自动安装，无需手动处理。

## 部署

1. **MC 侧**：安装 KuroBridge 插件（Paper JAR），在 `plugins/kurobridge/config.json` 的
   `ws` 段配置**固定端口**（external 部署必须，如 25580）与 `token`（强烈建议非空），
   并把目标群号加入 `channels` 绑定表；详细步骤见
   [peer-guide](https://github.com/Kuro-Bridge/KuroAdapter/blob/master/docs/protocol/peer-guide.md)。
2. **Koishi 侧**：安装本插件，`url` 填 `ws://<服务器地址>:<端口>`，`token` 与 MC 侧一致。
   跨公网必须走隧道（协议为明文 WS，无 TLS；推荐反代 TLS 终结或 wireguard）。
3. 验证：Koishi 日志出现 `kurobridge: 握手成功` 与绑定快照即通；群内发消息进游戏、
   游戏内发言回群。

**注意**：

- **一个逻辑协议端只保持一条连接**；同一 Koishi 实例不要配置多个 kurobridge 条目指向
  同一服务器（会导致游戏内消息重复）。
- **多对端并存**（如同时挂 napukettoqq 与本插件）：每个已握手对端都会收到全部游戏事件
  ——同频道会重复广播，属设计语义；如需避免，请让两端绑定不同频道。
- 命令的管理员判定在 MC 侧（`config.json` 的 `admins` 按 `channel + userId` 匹配），
  非管理员会收到 `命令失败：forbidden`。

## 开发

```bash
bun install            # 在宿主工作区根目录执行一次（workspace 成员依赖提升）
bun run check          # 门禁：biome + 类型检查
bun run test           # vitest（协议 golden 对表 + 连接/翻译/适配/装配四层）
bun run build          # 构建（产物 lib/index.cjs，CJS）
```

- 分层：`src/protocol/`（协议依赖统一出口）→ `src/connection.ts`（WS 客户端状态机）→
  `src/translate.ts`（纯函数翻译）→ `src/adapter.ts`（平台无关核心）→ `src/index.ts`
  （Koishi 装配）。平台渲染（富文本降级/色码剥离/长度收敛）只在本仓。
- **协议依赖**：插件以 `@kuro-bridge/protocol@^0.4.0` 为真实运行时依赖——0.4.0 起
  `exports` 为双格式（含 `require`），CJS 产物可直接 require 解析（ADR-001 阶段 2 落地，
  KD-10 结案）；tsdown 不再将协议包内联进产物，原 `alwaysBundle` 绕行例外已移除。
- KuroAdapter 侧协议改动须保持与已发布 `@kuro-bridge/protocol` 一致；本仓 golden 对表
  测试（`src/protocol/golden.test.ts`）锁定发布件线格式，上游漂移会在此立即红。

约定详见 `AGENTS.md`；执行实录与决策记录见 `docs/KUROBRIDGE-NOTES.md`。
