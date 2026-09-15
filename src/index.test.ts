/**
 * index.test.ts：Koishi 装配层集成测试（任务书 M5）。
 *
 * 轻量 ctx 桩（收集 broadcast / logger 调用，转发 on 注册的事件）+ 假服务端全链路：
 * apply → hello 身份 → 入站消息过滤（绑定/自过滤/命令分流）→ 游戏事件广播 → dispose。
 *
 * koishi 以 vi.mock 替换：@koishi-ce/core 运行时载入 .yml 本地化（Bun 原生支持，
 * vitest 的 Node 运行时不认）；装配测试只需 Schema 的链式声明面（无操作桩），
 * 类型检查仍走真实 koishi 类型（本文件 import type）。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
    const chain = () => {
        const node = {
            required: (): unknown => node,
            description: (): unknown => node,
            role: (): unknown => node,
            default: (): unknown => node,
        };
        return node;
    };
    return {
        Schema: {
            string: chain,
            number: chain,
            boolean: chain,
            // Config 声明只被 Koishi loader 调用；测试直接传全量配置给 apply
            object: () => (data: unknown) => data,
        },
    };
});

import type { Context } from "koishi";
import { apply, type Config } from "./index.js";
import { type FakeKurobridgeServer, startFakeKurobridgeServer, waitFor } from "./test-support.js";

/** broadcast 调用记录。 */
interface BroadcastRecord {
    channels: string[];
    content: string;
}

/** 轻量 ctx 桩：收集 broadcast 调用、按事件名分发 handler、logger 全收。 */
function makeCtxStub(): {
    ctx: Context;
    broadcasts: BroadcastRecord[];
    logs: { level: string; msg: string }[];
    emit: (event: string, payload: unknown) => void;
} {
    const broadcasts: BroadcastRecord[] = [];
    const logs: { level: string; msg: string }[] = [];
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    const makeLogger = (): Record<string, (msg: string) => void> => ({
        debug: (msg) => logs.push({ level: "debug", msg }),
        info: (msg) => logs.push({ level: "info", msg }),
        warn: (msg) => logs.push({ level: "warn", msg }),
        error: (msg) => logs.push({ level: "error", msg }),
    });
    const stub = {
        logger: () => makeLogger(),
        // 在线 bot 平台面（广播路由按 platform:channel 拼目标）+ 数据库在场
        bots: [{ platform: "mock", selfId: "514" }],
        database: {},
        broadcast: (channels: readonly string[], content: string) => {
            broadcasts.push({ channels: [...channels], content });
            return Promise.resolve([]);
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
            const list = handlers.get(event) ?? [];
            list.push(handler);
            handlers.set(event, list);
            return () => undefined;
        },
    };
    return {
        ctx: stub as unknown as Context,
        broadcasts,
        logs,
        emit: (event, payload) => {
            for (const handler of handlers.get(event) ?? []) {
                handler(payload);
            }
        },
    };
}

/** 全字段测试配置（对齐 Schema 缺省）。 */
function makeConfig(url: string): Config {
    return {
        url,
        token: "",
        name: "koishi-test",
        commandPrefix: "/",
        pingIntervalMs: 30,
        chatTemplate: "[{player}] {content}",
        joinTemplate: "{player} 加入了服务器",
        leaveTemplate: "{player} 离开了服务器",
        deathTemplate: "{player} {message}",
        stripColorCodes: true,
        maxMessageLength: 1500,
    };
}

/** session 桩（apply 只取 channelId/userId/selfId/username/elements）。 */
function sessionStub(fields: {
    channelId: string;
    userId: string;
    selfId: string;
    username?: string;
    content: string;
}): unknown {
    return {
        channelId: fields.channelId,
        userId: fields.userId,
        selfId: fields.selfId,
        username: fields.username,
        elements: [{ type: "text", attrs: { content: fields.content }, children: [] }],
    };
}

let shared: FakeKurobridgeServer | null = null;

async function server(): Promise<FakeKurobridgeServer> {
    if (shared === null) {
        shared = await startFakeKurobridgeServer();
    }
    return shared;
}

/** 建立到 established 的插件实例（ctx 桩 + apply）。 */
async function setupPlugin(
    bindings: string[],
): Promise<ReturnType<typeof makeCtxStub> & { config: Config }> {
    const s = await server();
    s.frames.length = 0;
    s.handshakes.length = 0;
    s.onClientFrame = (frame, conn) => {
        if (frame.header.type === "hello" && frame.header.id !== undefined) {
            s.send(conn, {
                type: "hello_ack",
                id: frame.header.id,
                body: {
                    ok: true,
                    serverId: "fake-server",
                    version: "1.0.0",
                    protocolVersion: "0.4.0",
                    channelBindings: bindings,
                },
            });
        }
    };
    const made = makeCtxStub();
    const config = makeConfig(`ws://127.0.0.1:${s.port}`);
    apply(made.ctx, config);
    await s.nextConnection();
    await waitFor(() => (s.frames.some((f) => f.header.type === "hello") ? true : null));
    return { ...made, config };
}

afterAll(async () => {
    await shared?.stop();
}, 10_000);

describe("Koishi 装配", () => {
    it("apply → 连接并握手：hello 身份按配置（peerId=配置 name，platform=koishi，client 自报）", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        const hello = s.frames.find((f) => f.header.type === "hello");
        expect(hello?.body).toMatchObject({
            peerId: "koishi-test",
            platform: "koishi",
            protocolVersion: "0.4.0",
        });
        expect((hello?.body as { version?: string } | undefined)?.version).toMatch(
            /^0\.1\.0$|unknown/,
        );
        expect((hello?.body as { client?: string } | undefined)?.client).toContain(
            "koishi-plugin-kurobridge",
        );
        expect((hello?.body as { token?: string } | undefined)?.token).toBeUndefined();
        emit("dispose", undefined);
    });

    it("入站消息：绑定频道 → chat 帧（sender = username ?? userId）", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        emit(
            "message",
            sessionStub({
                channelId: "967493177",
                userId: "10001",
                selfId: "bot",
                username: "群友A",
                content: "你好 MC",
            }),
        );
        await waitFor(() => s.frames.find((f) => f.header.type === "chat") ?? null);
        const chat = s.frames.find((f) => f.header.type === "chat");
        expect(chat?.body).toEqual({ channel: "967493177", sender: "群友A", content: "你好 MC" });
        emit("dispose", undefined);
    });

    it("自过滤：bot 自身消息不转发（KD-05 防环）", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        emit(
            "message",
            sessionStub({
                channelId: "967493177",
                userId: "bot",
                selfId: "bot",
                content: "自己说的",
            }),
        );
        await new Promise((r) => setTimeout(r, 60));
        expect(s.frames.find((f) => f.header.type === "chat")).toBeUndefined();
        emit("dispose", undefined);
    });

    it("命令分流：/ 开头 → command 帧", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        emit(
            "message",
            sessionStub({
                channelId: "967493177",
                userId: "10001",
                selfId: "bot",
                content: "/whitelist list",
            }),
        );
        await waitFor(() => s.frames.find((f) => f.header.type === "command") ?? null);
        const command = s.frames.find((f) => f.header.type === "command");
        expect(command?.body).toEqual({
            command: "whitelist list",
            source: { channel: "967493177", userId: "10001" },
        });
        emit("dispose", undefined);
    });

    it("游戏事件 → ctx.broadcast（裸频道号按在线 bot 平台拼 platform:channel）", async () => {
        const s = await server();
        const { emit, broadcasts } = await setupPlugin(["967493177"]);
        const conn = s.connections[s.connections.length - 1];
        if (conn === undefined) {
            throw new Error("无活跃连接");
        }
        s.send(conn, { type: "join", body: { channel: "967493177", playerName: "Alex" } });
        await waitFor(() => (broadcasts.length > 0 ? broadcasts[0] : null));
        expect(broadcasts[0]).toEqual({
            channels: ["mock:967493177"],
            content: "Alex 加入了服务器",
        });
        emit("dispose", undefined);
    });

    it("dispose → adapter 停止：服务端随后断开也不重连", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        const conn = s.connections[s.connections.length - 1];
        if (conn === undefined) {
            throw new Error("无活跃连接");
        }
        emit("dispose", undefined);
        conn.close(1001, "server shutdown");
        const handshakes = s.handshakes.length;
        await new Promise((r) => setTimeout(r, 120));
        expect(s.handshakes.length).toBe(handshakes);
    });

    it("多消息同频道：sender 无 username 时退 userId", async () => {
        const s = await server();
        const { emit } = await setupPlugin(["967493177"]);
        emit(
            "message",
            sessionStub({
                channelId: "967493177",
                userId: "10086",
                selfId: "bot",
                content: "没有昵称",
            }),
        );
        await waitFor(() => s.frames.find((f) => f.header.type === "chat") ?? null);
        const chat = s.frames.find((f) => f.header.type === "chat");
        expect(chat?.body).toMatchObject({ sender: "10086" });
        emit("dispose", undefined);
    });
});
