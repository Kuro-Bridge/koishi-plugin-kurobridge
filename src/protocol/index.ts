/**
 * 协议镜像统一出口（KD-01 单点切换面）
 *
 * `@kuro-bridge/protocol` 未发布 npm（2026-09-15 实测），当前从本目录镜像 re-export；
 * **真包发布后：删除本文件对 `./meta` `./frame` `./ws` 的引用，改为
 * `export * from "@kuro-bridge/protocol"`（或按需具名），仓内其余代码零改动**。
 * 仓内代码一律 `import ... from "../protocol/index.js"`（或等价相对路径），禁止直探
 * meta/frame/ws 深层模块——切换面收敛在这一处。
 */

export type {
    CommandResultBody,
    EventMessage,
    FrameHeader,
    RequestMessage,
    ResultBody,
    WireFrame,
} from "./frame.js";
export {
    commandResultBodySchema,
    encodeFrame,
    eventFrameSchema,
    frameHeaderSchema,
    requestFrameSchema,
    resultBodySchema,
    wireFrameSchema,
} from "./frame.js";
export {
    isProtocolVersionCompatible,
    PROTOCOL_NAME,
    PROTOCOL_VERSION,
    WS_SUBPROTOCOL,
} from "./meta.js";
export type {
    BindingsUpdatedBody,
    BindingsUpdatedFrame,
    CommandBody,
    CommandFrame,
    CommandSource,
    DeathBody,
    DeathFrame,
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
    StatusBody,
    StatusFrame,
} from "./ws.js";
export {
    bindingsUpdatedFrame,
    commandFrame,
    commandResultFrame,
    deathFrame,
    gameChatFrame,
    helloAckFrame,
    helloFrame,
    joinFrame,
    leaveFrame,
    pingFrame,
    platformChatFrame,
    pongFrame,
    queryFrame,
    queryResultFrame,
    statusFrame,
    wsOutboundFrame,
} from "./ws.js";
