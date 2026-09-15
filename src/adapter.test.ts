/**
 * adapter.test.ts：KurobridgeAdapter 假服务端全链路单测（任务书 M4）。
 *
 * 覆盖：入站过滤链（绑定/空文本/命令分流/空命令忽略）、command_result 三态渲染、
 * 服务端四事件模板渲染 + § 剥离 + 截断、bindings 热更、query 往返、status 透传、
 * forwardCommand 不做绑定过滤。
 */
import { afterAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { GameEventType } from "./adapter.js";
import { KurobridgeAdapter } from "./adapter.js";
import {
    type FakeKurobridgeServer,
    type FakeServerFrame,
    startFakeKurobridgeServer,
    waitFor,
} from "./test-support.js";
import { DEFAULT_TEMPLATES, type RenderOptions } from "./translate.js";

/** 测试快参数（抖动归零保确定性）。 */
const FAST = {
    pingIntervalMs: 30,
    helloTimeoutMs: 1000,
    retryBaseDelayMs: 20,
    retryMaxDelayMs: 60,
    retryJitter: 0,
    queryTimeoutMs: 500,
} as const;

/** 捕获回调的适配器工厂。 */
function makeAdapter(
    url: string,
    overrides?: {
        commandPrefix?: string;
        render?: Partial<RenderOptions>;
    },
): {
    adapter: KurobridgeAdapter;
    events: { type: GameEventType; rendered: string; channel: string }[];
    statuses: unknown[];
    logs: string[];
} {
    const events: { type: GameEventType; rendered: string; channel: string }[] = [];
    const statuses: unknown[] = [];
    const logs: string[] = [];
    const render: RenderOptions = {
        chatTemplate: DEFAULT_TEMPLATES.chat,
        joinTemplate: DEFAULT_TEMPLATES.join,
        leaveTemplate: DEFAULT_TEMPLATES.leave,
        deathTemplate: DEFAULT_TEMPLATES.death,
        stripColorCodes: true,
        maxMessageLength: 1500,
        ...overrides?.render,
    };
    const adapter = new KurobridgeAdapter({
        url,
        hello: {
            peerId: "koishi",
            platform: "koishi",
            version: "0.1.0",
            protocolVersion: "0.4.0",
            client: "koishi-plugin-kurobridge/0.1.0",
        },
        commandPrefix: overrides?.commandPrefix ?? "/",
        render,
        ...FAST,
        callbacks: {
            onLog: (_level, msg) => logs.push(msg),
            onGameEvent: (type, rendered, channel) => events.push({ type, rendered, channel }),
            onStatus: (status) => statuses.push(status),
        },
    });
    return { adapter, events, statuses, logs };
}

/** 服务端自动应答 hello（ok + 绑定快照）。 */
function autoAck(server: FakeKurobridgeServer, bindings: string[]): void {
    server.onClientFrame = (frame, conn) => {
        if (frame.header.type === "hello" && frame.header.id !== undefined) {
            server.send(conn, {
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
}

/** 服务端应答 command → command_result（可注入 body）。 */
function answerCommands(server: FakeKurobridgeServer, body: (id: string) => unknown): void {
    const prev = server.onClientFrame;
    server.onClientFrame = (frame: FakeServerFrame, conn: WebSocket) => {
        prev(frame, conn);
        if (frame.header.type === "command" && frame.header.id !== undefined) {
            server.send(conn, {
                type: "command_result",
                id: frame.header.id,
                body: body(frame.header.id),
            });
        }
    };
}

/** 服务端应答 query → query_result（kind=bindings 回列表）。 */
function answerQueries(server: FakeKurobridgeServer): void {
    const prev = server.onClientFrame;
    server.onClientFrame = (frame, conn) => {
        prev(frame, conn);
        if (frame.header.type === "query" && frame.header.id !== undefined) {
            server.send(conn, {
                type: "query_result",
                id: frame.header.id,
                body: { ok: true, data: ["967493177"] },
            });
        }
    };
}

let shared: FakeKurobridgeServer | null = null;

async function server(): Promise<FakeKurobridgeServer> {
    if (shared === null) {
        shared = await startFakeKurobridgeServer();
    }
    return shared;
}

/** 建立到 established 的适配器（等待绑定快照落地）。 */
async function establishedAdapter(
    bindings: string[],
    overrides?: { commandPrefix?: string; render?: Partial<RenderOptions> },
): Promise<ReturnType<typeof makeAdapter>> {
    const s = await server();
    s.frames.length = 0;
    autoAck(s, bindings);
    const made = makeAdapter(`ws://127.0.0.1:${s.port}`, overrides);
    made.adapter.start();
    await s.nextConnection();
    await waitFor(() => (made.adapter.getBindings().length === bindings.length ? true : null));
    return made;
}

afterAll(async () => {
    await shared?.stop();
}, 10_000);

/** 元素便捷构造（TreeElement 结构面）。 */
function textEl(content: string): {
    type: string;
    attrs: Record<string, unknown>;
    children: never[];
} {
    return { type: "text", attrs: { content }, children: [] };
}

describe("入站过滤链", () => {
    it("绑定频道文本 → chat 帧（sender + 降级内容）", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        const ok = adapter.handleInbound("967493177", "10001", "群友A", [textEl("你好 MC")]);
        expect(ok).toBe(true);
        const s = await server();
        await waitFor(() => s.frames.find((f) => f.header.type === "chat") ?? null);
        const chat = s.frames.find((f) => f.header.type === "chat");
        expect(chat?.body).toEqual({ channel: "967493177", sender: "群友A", content: "你好 MC" });
        adapter.stop();
    });

    it("未绑定频道 → 丢弃（绑定表 SSOT 在服务端）", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        expect(adapter.handleInbound("999", "10001", "群友A", [textEl("你好")])).toBe(false);
        const s = await server();
        await new Promise((r) => setTimeout(r, 60));
        expect(s.frames.find((f) => f.header.type === "chat")).toBeUndefined();
        adapter.stop();
    });

    it("降级为空（纯空白）→ 不发", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        expect(adapter.handleInbound("967493177", "10001", "群友A", [textEl("   ")])).toBe(false);
        const s = await server();
        await new Promise((r) => setTimeout(r, 60));
        expect(s.frames.find((f) => f.header.type === "chat")).toBeUndefined();
        adapter.stop();
    });

    it("命令前缀分流：/开头 → command 帧不发 chat；斜杠本身不出现在 command", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        const ok = adapter.handleInbound("967493177", "10001", "群友A", [
            textEl("/whitelist list"),
        ]);
        expect(ok).toBe(true);
        const s = await server();
        await waitFor(() => s.frames.find((f) => f.header.type === "command") ?? null);
        const command = s.frames.find((f) => f.header.type === "command");
        expect(command?.body).toEqual({
            command: "whitelist list",
            source: { channel: "967493177", userId: "10001" },
        });
        expect(s.frames.find((f) => f.header.type === "chat")).toBeUndefined();
        adapter.stop();
    });

    it("空命令忽略（只有前缀）", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        expect(adapter.handleInbound("967493177", "10001", "群友A", [textEl("/")])).toBe(false);
        expect(adapter.handleInbound("967493177", "10001", "群友A", [textEl("/   ")])).toBe(false);
        const s = await server();
        await new Promise((r) => setTimeout(r, 60));
        expect(s.frames.find((f) => f.header.type === "command")).toBeUndefined();
        expect(s.frames.find((f) => f.header.type === "chat")).toBeUndefined();
        adapter.stop();
    });

    it("forwardCommand 不做绑定过滤（对齐服务端 dispatchCommand 语义）", async () => {
        const { adapter } = await establishedAdapter(["967493177"]);
        expect(adapter.forwardCommand("999", "10001", "list")).toBe(true);
        const s = await server();
        await waitFor(() => s.frames.find((f) => f.header.type === "command") ?? null);
        expect(s.frames.find((f) => f.header.type === "command")?.body).toMatchObject({
            source: { channel: "999" },
        });
        adapter.stop();
    });
});

describe("command_result 三态渲染（pending 路由回来源频道）", () => {
    it.each([
        {
            name: "ok:false → 命令失败",
            body: { ok: false, error: "forbidden" },
            expected: "命令失败：forbidden",
        },
        { name: "ok:true 无输出", body: { ok: true }, expected: "（命令执行成功，无输出）" },
        { name: "ok:true 多行输出", body: { ok: true, output: ["a", "b"] }, expected: "a\nb" },
    ])("$name", async ({ body, expected }) => {
        const { adapter, events } = await establishedAdapter(["967493177"]);
        const s = await server();
        answerCommands(s, () => body);
        adapter.handleInbound("967493177", "10001", "群友A", [textEl("/list")]);
        await waitFor(() => events.find((e) => e.type === "command_result") ?? null);
        const event = events.find((e) => e.type === "command_result");
        expect(event?.rendered).toBe(expected);
        expect(event?.channel).toBe("967493177");
        adapter.stop();
    });
});

describe("服务端事件 → 模板渲染广播", () => {
    it("四事件 + § 剥离 + 截断", async () => {
        const { adapter, events } = await establishedAdapter(["1"], {
            render: { maxMessageLength: 20 },
        });
        const s = await server();
        const conn = s.connections[s.connections.length - 1];
        if (conn === undefined) {
            throw new Error("无活跃连接");
        }
        s.send(conn, {
            type: "chat",
            body: { channel: "1", playerName: "§aSteve", content: "§r大家好" },
        });
        s.send(conn, { type: "join", body: { channel: "1", playerName: "Alex" } });
        s.send(conn, { type: "leave", body: { channel: "1", playerName: "Alex" } });
        s.send(conn, { type: "death", body: { channel: "1", player: "Steve", message: "" } });
        s.send(conn, {
            type: "chat",
            body: { channel: "1", playerName: "P", content: "x".repeat(30) },
        });
        await waitFor(() => (events.filter((e) => e.type === "death").length > 0 ? true : null));
        expect(
            events.find((e) => e.type === "chat" && e.rendered.includes("Steve"))?.rendered,
        ).toBe("[Steve] 大家好");
        expect(events.find((e) => e.type === "join")?.rendered).toBe("Alex 加入了服务器");
        expect(events.find((e) => e.type === "leave")?.rendered).toBe("Alex 离开了服务器");
        expect(events.find((e) => e.type === "death")?.rendered).toBe("Steve 死亡了");
        expect(
            events.filter((e) => e.type === "chat" && e.rendered.includes("x"))[0]?.rendered,
        ).toBe(`[P] ${"x".repeat(16)}…(截断)`);
        adapter.stop();
    });

    it("status 帧透传 onStatus（无 channel）", async () => {
        const { adapter, statuses } = await establishedAdapter(["1"]);
        const s = await server();
        const conn = s.connections[s.connections.length - 1];
        if (conn === undefined) {
            throw new Error("无活跃连接");
        }
        s.send(conn, { type: "status", body: { tps: 20, onlinePlayers: 2, uptimeSeconds: 60 } });
        await waitFor(() => (statuses.length > 0 ? statuses[0] : null));
        expect(statuses[0]).toEqual({ tps: 20, onlinePlayers: 2, uptimeSeconds: 60 });
        adapter.stop();
    });
});

describe("绑定集热更与查询", () => {
    it("bindings_updated 全量热更：旧频道失效、新频道生效", async () => {
        const { adapter } = await establishedAdapter(["1"]);
        const s = await server();
        const conn = s.connections[s.connections.length - 1];
        if (conn === undefined) {
            throw new Error("无活跃连接");
        }
        expect(adapter.getBindings()).toEqual(["1"]);
        s.send(conn, { type: "bindings_updated", body: { channelBindings: ["2"] } });
        await waitFor(() => (adapter.getBindings().includes("2") ? true : null));
        expect(adapter.getBindings()).toEqual(["2"]);
        expect(adapter.handleInbound("1", "u", "s", [textEl("hi")])).toBe(false); // 旧频道过滤
        expect(adapter.handleInbound("2", "u", "s", [textEl("hi")])).toBe(true); // 新频道放行
        adapter.stop();
    });

    it("query bindings 往返 resolve；未建立连接直接 reject", async () => {
        const { adapter } = await establishedAdapter(["1"]);
        const s = await server();
        answerQueries(s);
        const result = await adapter.query("bindings");
        expect(result).toMatchObject({ ok: true, data: ["967493177"] });
        adapter.stop();
        await expect(adapter.query("bindings")).rejects.toThrow("未建立连接");
    });
});
