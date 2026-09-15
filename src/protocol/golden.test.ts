/**
 * golden 帧对表测试 —— 锁定 `@kuro-bridge/protocol` 发布件的线格式
 *
 * 对表基线：KuroAdapter master `17be8f6`（协议 0.4.0）。KD-01 镜像时期用于人工同步，
 * 真包接入（KD-09）后对象改为包导出：常量逐字、encodeFrame 逐字节、schema 线格式
 * 双向（正形收窄为扁平消息、错形拒绝）。上游发布件若与预期漂移，此处立即红。
 */
import { describe, expect, it } from "vitest";

import {
    bindingsUpdatedFrame,
    commandFrame,
    commandResultFrame,
    deathFrame,
    encodeFrame,
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
    statusFrame,
    WS_SUBPROTOCOL,
    wsOutboundFrame,
} from "./index.js";

/** 固定 v4 形状 UUID（版本/变体位合法，通过 z.uuid()） */
const UUID = "00000000-0000-4000-8000-000000000000";

describe("协议常量对表（0.4.0 / ADR-030 品牌迁移）", () => {
    it("PROTOCOL_NAME / PROTOCOL_VERSION / WS_SUBPROTOCOL", () => {
        expect(PROTOCOL_NAME).toBe("kurobridge-ws");
        expect(PROTOCOL_VERSION).toBe("0.4.0");
        expect(WS_SUBPROTOCOL).toBe("kurobridge-ws.v1");
    });

    it("isProtocolVersionCompatible：主版本号相同即兼容（ADR-026）", () => {
        expect(isProtocolVersionCompatible("0.4.0", "0.4.0")).toBe(true);
        expect(isProtocolVersionCompatible("0.3.1", "0.4.0")).toBe(true);
        expect(isProtocolVersionCompatible("1.0.0", "0.4.0")).toBe(false);
        expect(isProtocolVersionCompatible("garbage", "0.4.0")).toBe(false);
        expect(isProtocolVersionCompatible("0.4.0", "x.y.z")).toBe(false);
    });
});

describe("encodeFrame 线格式逐字节（扁平消息 → 单行 JSON 文本帧）", () => {
    it("事件帧：header 只有 type，无 id 字段", () => {
        const wire = encodeFrame({
            type: "chat",
            body: { channel: "967493177", sender: "alice", content: "你好" },
        });
        expect(wire).toBe(
            '{"header":{"type":"chat"},"body":{"channel":"967493177","sender":"alice","content":"你好"}}',
        );
    });

    it("请求帧：header 为 type+id（id 存在才产生字段）", () => {
        const wire = encodeFrame({ type: "ping", id: UUID, body: { timestamp: 1700000000 } });
        expect(wire).toBe(
            '{"header":{"type":"ping","id":"00000000-0000-4000-8000-000000000000"},"body":{"timestamp":1700000000}}',
        );
    });

    it("body 键序 = 传入对象插入序（服务端 golden 依赖此稳定性）", () => {
        const wire = encodeFrame({
            type: "hello",
            id: UUID,
            body: {
                peerId: "koishi",
                platform: "koishi",
                version: "0.1.0",
                protocolVersion: "0.4.0",
            },
        });
        expect(wire).toBe(
            '{"header":{"type":"hello","id":"00000000-0000-4000-8000-000000000000"},' +
                '"body":{"peerId":"koishi","platform":"koishi","version":"0.1.0","protocolVersion":"0.4.0"}}',
        );
    });
});

/** 线 JSON → schema.parse → 扁平消息（两段式解析第二段，ADR-026） */
function parseWire<T extends { parse: (input: unknown) => unknown }>(
    schema: T,
    wire: string,
): unknown {
    return schema.parse(JSON.parse(wire));
}

describe("Peer → Server 帧线格式", () => {
    it("hello：全字段（token/client 可选）收窄为扁平请求", () => {
        const parsed = parseWire(
            helloFrame,
            encodeFrame({
                type: "hello",
                id: UUID,
                body: {
                    peerId: "koishi",
                    platform: "koishi",
                    version: "0.1.0",
                    protocolVersion: "0.4.0",
                    token: "secret",
                    client: "koishi-plugin-kurobridge/0.1.0",
                },
            }),
        );
        expect(parsed).toEqual({
            type: "hello",
            id: UUID,
            body: {
                peerId: "koishi",
                platform: "koishi",
                version: "0.1.0",
                protocolVersion: "0.4.0",
                token: "secret",
                client: "koishi-plugin-kurobridge/0.1.0",
            },
        });
    });

    it("hello：token/client 缺省合法；缺 peerId 拒绝", () => {
        const base = encodeFrame({
            type: "hello",
            id: UUID,
            body: {
                peerId: "koishi",
                platform: "koishi",
                version: "0.1.0",
                protocolVersion: "0.4.0",
            },
        });
        expect(parseWire(helloFrame, base)).toEqual({
            type: "hello",
            id: UUID,
            body: {
                peerId: "koishi",
                platform: "koishi",
                version: "0.1.0",
                protocolVersion: "0.4.0",
            },
        });
        expect(() =>
            parseWire(
                helloFrame,
                encodeFrame({
                    type: "hello",
                    id: UUID,
                    body: { platform: "koishi", version: "0.1.0", protocolVersion: "0.4.0" },
                }),
            ),
        ).toThrow();
    });

    it("hello：protocolVersion 非语义化三元组拒绝", () => {
        expect(() =>
            parseWire(
                helloFrame,
                encodeFrame({
                    type: "hello",
                    id: UUID,
                    body: { peerId: "k", platform: "k", version: "1", protocolVersion: "0.4" },
                }),
            ),
        ).toThrow();
    });

    it("chat（平台→游戏）：channel/sender/content", () => {
        const parsed = parseWire(
            platformChatFrame,
            encodeFrame({ type: "chat", body: { channel: "1", sender: "bob", content: "hi" } }),
        );
        expect(parsed).toEqual({
            type: "chat",
            body: { channel: "1", sender: "bob", content: "hi" },
        });
    });

    it("command：command + source{channel,userId}", () => {
        const parsed = parseWire(
            commandFrame,
            encodeFrame({
                type: "command",
                id: UUID,
                body: { command: "whitelist list", source: { channel: "1", userId: "42" } },
            }),
        );
        expect(parsed).toEqual({
            type: "command",
            id: UUID,
            body: { command: "whitelist list", source: { channel: "1", userId: "42" } },
        });
    });

    it("query：kind 二值字面量", () => {
        expect(
            parseWire(
                queryFrame,
                encodeFrame({ type: "query", id: UUID, body: { kind: "status" } }),
            ),
        ).toEqual({ type: "query", id: UUID, body: { kind: "status" } });
        expect(() =>
            parseWire(
                queryFrame,
                encodeFrame({ type: "query", id: UUID, body: { kind: "other" } }),
            ),
        ).toThrow();
    });

    it("ping：timestamp 非负整数", () => {
        expect(
            parseWire(pingFrame, encodeFrame({ type: "ping", id: UUID, body: { timestamp: 0 } })),
        ).toEqual({ type: "ping", id: UUID, body: { timestamp: 0 } });
        expect(() =>
            parseWire(pingFrame, encodeFrame({ type: "ping", id: UUID, body: { timestamp: -1 } })),
        ).toThrow();
    });
});

describe("Server → Peer 帧线格式", () => {
    it("hello_ack ok:true：serverId/version/protocolVersion/channelBindings 快照", () => {
        const parsed = parseWire(
            helloAckFrame,
            encodeFrame({
                type: "hello_ack",
                id: UUID,
                body: {
                    ok: true,
                    serverId: "paper-01",
                    version: "0.4.0",
                    protocolVersion: "0.4.0",
                    channelBindings: ["967493177"],
                },
            }),
        );
        expect(parsed).toEqual({
            type: "hello_ack",
            id: UUID,
            body: {
                ok: true,
                serverId: "paper-01",
                version: "0.4.0",
                protocolVersion: "0.4.0",
                channelBindings: ["967493177"],
            },
        });
    });

    it("hello_ack ok:true：空绑定数组合法", () => {
        const parsed = parseWire(
            helloAckFrame,
            encodeFrame({
                type: "hello_ack",
                id: UUID,
                body: {
                    ok: true,
                    serverId: "s",
                    version: "1",
                    protocolVersion: "0.4.0",
                    channelBindings: [],
                },
            }),
        );
        expect(parsed).toMatchObject({ body: { ok: true, channelBindings: [] } });
    });

    it("hello_ack ok:false：reason 必填", () => {
        const parsed = parseWire(
            helloAckFrame,
            encodeFrame({
                type: "hello_ack",
                id: UUID,
                body: { ok: false, reason: "auth failed" },
            }),
        );
        expect(parsed).toMatchObject({ body: { ok: false, reason: "auth failed" } });
        expect(() =>
            parseWire(
                helloAckFrame,
                encodeFrame({ type: "hello_ack", id: UUID, body: { ok: false } }),
            ),
        ).toThrow();
    });

    it("pong：同 id 回 timestamp", () => {
        expect(
            parseWire(pongFrame, encodeFrame({ type: "pong", id: UUID, body: { timestamp: 7 } })),
        ).toEqual({ type: "pong", id: UUID, body: { timestamp: 7 } });
    });

    it("chat（游戏→平台）：playerName（与入站方向 body 形状不同）", () => {
        const parsed = parseWire(
            gameChatFrame,
            encodeFrame({
                type: "chat",
                body: { channel: "1", playerName: "Steve", content: "gg" },
            }),
        );
        expect(parsed).toEqual({
            type: "chat",
            body: { channel: "1", playerName: "Steve", content: "gg" },
        });
    });

    it("join / leave：channel + playerName", () => {
        expect(
            parseWire(
                joinFrame,
                encodeFrame({ type: "join", body: { channel: "1", playerName: "Steve" } }),
            ),
        ).toEqual({ type: "join", body: { channel: "1", playerName: "Steve" } });
        expect(
            parseWire(
                leaveFrame,
                encodeFrame({ type: "leave", body: { channel: "1", playerName: "Steve" } }),
            ),
        ).toEqual({ type: "leave", body: { channel: "1", playerName: "Steve" } });
    });

    it("death：字段名 player/message（与 join/leave 的 playerName 不一致——照抄 SSOT）", () => {
        const parsed = parseWire(
            deathFrame,
            encodeFrame({ type: "death", body: { channel: "1", player: "Steve", message: "" } }),
        );
        expect(parsed).toEqual({
            type: "death",
            body: { channel: "1", player: "Steve", message: "" },
        });
    });

    it("status：无 channel（全服状态）", () => {
        const parsed = parseWire(
            statusFrame,
            encodeFrame({
                type: "status",
                body: { tps: 19.95, onlinePlayers: 3, uptimeSeconds: 120 },
            }),
        );
        expect(parsed).toEqual({
            type: "status",
            body: { tps: 19.95, onlinePlayers: 3, uptimeSeconds: 120 },
        });
    });

    it("bindings_updated：全量列表（非增量，ADR-004）", () => {
        const parsed = parseWire(
            bindingsUpdatedFrame,
            encodeFrame({ type: "bindings_updated", body: { channelBindings: ["1", "2"] } }),
        );
        expect(parsed).toEqual({ type: "bindings_updated", body: { channelBindings: ["1", "2"] } });
    });

    it("command_result：ok:false 带 error；ok:true 的 output 可选", () => {
        expect(
            parseWire(
                commandResultFrame,
                encodeFrame({
                    type: "command_result",
                    id: UUID,
                    body: { ok: false, error: "boom" },
                }),
            ),
        ).toMatchObject({ body: { ok: false, error: "boom" } });
        expect(
            parseWire(
                commandResultFrame,
                encodeFrame({ type: "command_result", id: UUID, body: { ok: true } }),
            ),
        ).toMatchObject({ body: { ok: true } });
        expect(
            parseWire(
                commandResultFrame,
                encodeFrame({
                    type: "command_result",
                    id: UUID,
                    body: { ok: true, output: ["line1", "line2"] },
                }),
            ),
        ).toMatchObject({ body: { ok: true, output: ["line1", "line2"] } });
    });

    it("query_result：data 形状由 kind 决定（协议层不强校验）", () => {
        expect(
            parseWire(
                queryResultFrame,
                encodeFrame({
                    type: "query_result",
                    id: UUID,
                    body: { ok: true, data: { tps: 20 } },
                }),
            ),
        ).toMatchObject({ body: { ok: true, data: { tps: 20 } } });
        expect(
            parseWire(
                queryResultFrame,
                encodeFrame({ type: "query_result", id: UUID, body: { ok: true, data: ["1"] } }),
            ),
        ).toMatchObject({ body: { ok: true, data: ["1"] } });
        expect(() =>
            parseWire(
                queryResultFrame,
                encodeFrame({ type: "query_result", id: UUID, body: { ok: true } }),
            ),
        ).toThrow();
    });
});

describe("帧骨架约束（方向误用尽早暴露）", () => {
    it("事件帧携带 id → 拒绝", () => {
        expect(() =>
            parseWire(
                joinFrame,
                encodeFrame({ type: "join", id: UUID, body: { channel: "1", playerName: "S" } }),
            ),
        ).toThrow();
    });

    it("请求帧缺 id / id 非 UUID → 拒绝", () => {
        expect(() =>
            parseWire(pingFrame, '{"header":{"type":"ping"},"body":{"timestamp":1}}'),
        ).toThrow();
        expect(() =>
            parseWire(
                pingFrame,
                '{"header":{"type":"ping","id":"not-uuid"},"body":{"timestamp":1}}',
            ),
        ).toThrow();
    });

    it("帧 type 不匹配字面量 → 拒绝", () => {
        expect(() =>
            parseWire(
                joinFrame,
                '{"header":{"type":"leave"},"body":{"channel":"1","playerName":"S"}}',
            ),
        ).toThrow();
    });

    it("wsOutboundFrame：接受全部 Server → Peer 已知帧", () => {
        const samples = [
            `{"header":{"type":"pong","id":"${UUID}"},"body":{"timestamp":1}}`,
            '{"header":{"type":"chat"},"body":{"channel":"1","playerName":"S","content":"c"}}',
            '{"header":{"type":"join"},"body":{"channel":"1","playerName":"S"}}',
            '{"header":{"type":"leave"},"body":{"channel":"1","playerName":"S"}}',
            '{"header":{"type":"death"},"body":{"channel":"1","player":"S","message":"m"}}',
            '{"header":{"type":"status"},"body":{"tps":20,"onlinePlayers":0,"uptimeSeconds":1}}',
            '{"header":{"type":"bindings_updated"},"body":{"channelBindings":[]}}',
        ];
        for (const wire of samples) {
            expect(() => wsOutboundFrame.parse(JSON.parse(wire))).not.toThrow();
        }
    });
});
