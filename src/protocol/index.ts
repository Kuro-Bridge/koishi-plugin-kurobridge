/**
 * 协议依赖统一出口（KD-01 切换面，KD-09 已完成真包接入）
 *
 * 从 `@kuro-bridge/protocol`（0.4.0，KuroAdapter SSOT 发布包）具名 re-export——
 * 符号名两侧一致，镜像过渡形态（meta/frame/ws 三件套）已删除。仓内代码一律
 * `import ... from "../protocol/index.js"`（或等价相对路径），禁止直探包内深层
 * 模块——协议升级只改这一处。
 *
 * golden 对表测试（`./golden.test.js`）锁定包导出的 encodeFrame/schema 线格式，
 * 防上游发布件与本仓预期漂移。
 */

export type {
    BindingsUpdatedBody,
    BindingsUpdatedFrame,
    CommandBody,
    CommandFrame,
    CommandResultBody,
    CommandSource,
    DeathBody,
    DeathFrame,
    EventMessage,
    Fixture,
    FrameHeader,
    GameChatBody,
    GameChatFrame,
    HelloAckBody,
    HelloAckErrorBody,
    HelloAckFrame,
    HelloAckOkBody,
    HelloBody,
    HelloFrame,
    JoinBody,
    JoinFrame,
    LeaveBody,
    LeaveFrame,
    PingBody,
    PingFrame,
    PlatformChatBody,
    PlatformChatFrame,
    PongBody,
    PongFrame,
    QueryBody,
    QueryFrame,
    QueryResultBody,
    QueryResultFrame,
    RequestMessage,
    ResultBody,
    StatusBody,
    StatusFrame,
    WireFrame,
} from "@kuro-bridge/protocol";
export {
    bindingsUpdatedFrame,
    commandFrame,
    commandResultBodySchema,
    commandResultFrame,
    deathFrame,
    encodeFrame,
    eventFrameSchema,
    fixtureSchema,
    frameHeaderSchema,
    gameChatFrame,
    helloAckFrame,
    helloFrame,
    isProtocolVersionCompatible,
    joinFrame,
    leaveFrame,
    PROTOCOL_NAME,
    PROTOCOL_VERSION,
    pingFrame,
    platformChatFrame,
    pongFrame,
    queryFrame,
    queryResultFrame,
    requestFrameSchema,
    resultBodySchema,
    statusFrame,
    validateFixture,
    WS_SUBPROTOCOL,
    wireFrameSchema,
    wsOutboundFrame,
} from "@kuro-bridge/protocol";
