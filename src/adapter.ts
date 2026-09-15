/**
 * KurobridgeAdapter：平台无关适配核心（任务书 M4，KD-08 不 import koishi）。
 *
 * 持有连接层 + 绑定集状态（SSOT 在服务端：hello_ack 快照 + bindings_updated 全量热更，
 * KD-04）+ 命令/查询 pending 表（UUID 关联）。
 *
 * 对宿主暴露回调：onLog / onGameEvent(type, rendered, channel)（宿主广播到平台）/
 * onStatus（服务器状态帧透传，StatusBody 无 channel）。
 * 宿主调用面：start / handleInbound（绑定过滤 + 降级 + 命令前缀分流）/ forwardChat /
 * forwardCommand（不做绑定过滤，对齐服务端 dispatchCommand 语义）/ query / stop。
 */
import { randomUUID } from "node:crypto";
import {
    type ConnectionLogLevel,
    KurobridgeConnection,
    type KurobridgeHello,
    type ServerEventMessage,
} from "./connection.js";
import type { CommandResultBody, QueryResultBody, StatusBody } from "./protocol/index.js";
import {
    degradeElements,
    type GameEventKind,
    type RenderOptions,
    renderCommandResult,
    renderGameEvent,
    type TreeElement,
} from "./translate.js";

/** 广播到平台的事件类型（四类游戏事件 + 命令回执渲染）。 */
export type GameEventType = GameEventKind | "command_result";

/** 查询类别（对齐协议 query.kind）。 */
export type QueryKind = "status" | "bindings";

/** 宿主回调面（M5 装配为 ctx.logger / ctx.broadcast / 状态展示）。 */
export interface AdapterCallbacks {
    onLog: (level: ConnectionLogLevel, msg: string, extra?: Record<string, unknown>) => void;
    /** 渲染完成的游戏事件/命令回执（宿主负责广播到对应平台频道）。 */
    onGameEvent: (type: GameEventType, rendered: string, channel: string) => void;
    /** 服务器状态帧透传（全服状态，无 channel）。 */
    onStatus: (status: StatusBody) => void;
}

/** 适配层参数（连接节奏必填——测试快值 / M5 Schema 缺省二选一注入）。 */
export interface KurobridgeAdapterOptions {
    url: string;
    hello: KurobridgeHello;
    /** 入站命令前缀（前缀开头 → command 帧，不再作为 chat 发送）。 */
    commandPrefix: string;
    /** 出站渲染选项（四模板/色码剥离/截断）。 */
    render: RenderOptions;
    pingIntervalMs: number;
    helloTimeoutMs: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    /** 退避抖动幅度 0..1（±ratio；测试传 0）。 */
    retryJitter: number;
    /** query 请求超时毫秒（服务端 IPC 超时 10s，对齐）。 */
    queryTimeoutMs: number;
    callbacks: AdapterCallbacks;
}

/**
 * kurobridge-ws 适配核心：连接生命周期 + 入站过滤链 + 出站渲染分发 +
 * 请求-响应关联（command/query 的 UUID pending 表）。
 */
export class KurobridgeAdapter {
    private readonly opts: KurobridgeAdapterOptions;
    private readonly connection: KurobridgeConnection;
    /** 当前绑定频道集（服务端 SSOT 的本地镜像）。 */
    private bindings: ReadonlySet<string> = new Set();
    /** 命令 pending：请求 UUID → 来源频道（command_result 回执路由）。 */
    private readonly commandPending = new Map<string, string>();
    /** 查询 pending：请求 UUID → resolve/reject + 超时定时器。 */
    private readonly queryPending = new Map<
        string,
        {
            resolve: (body: QueryResultBody) => void;
            reject: (err: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();

    constructor(opts: KurobridgeAdapterOptions) {
        this.opts = opts;
        this.connection = new KurobridgeConnection({
            url: opts.url,
            hello: opts.hello,
            pingIntervalMs: opts.pingIntervalMs,
            helloTimeoutMs: opts.helloTimeoutMs,
            retryBaseDelayMs: opts.retryBaseDelayMs,
            retryMaxDelayMs: opts.retryMaxDelayMs,
            retryJitter: opts.retryJitter,
            onLog: (level, msg, extra) => opts.callbacks.onLog(level, msg, extra),
            onEstablished: (ack) => this.handleEstablished(ack.channelBindings),
            onFrame: (msg) => this.handleFrame(msg),
            onEnded: (reason) =>
                opts.callbacks.onLog(
                    "error",
                    `连接永久停止：${reason.detail}`,
                    reason.code === undefined ? undefined : { code: reason.code },
                ),
        });
    }

    /** 启动连接（幂等，见连接层）。 */
    start(): void {
        this.opts.callbacks.onLog("info", "适配器启动，发起连接");
        this.connection.start();
    }

    /** 停止连接（静默；宿主 dispose 时调用）。 */
    stop(): void {
        this.failAllPending("连接已停止");
        this.connection.stop();
    }

    /** 当前绑定频道集快照（调试/展示用）。 */
    getBindings(): string[] {
        return [...this.bindings];
    }

    /**
     * 入站消息统一入口（M5 传入 session 要素）：绑定过滤（命令不受限）→ 元素降级 →
     * 命令前缀分流（空命令忽略）→ chat 帧。
     */
    handleInbound(
        channel: string,
        userId: string,
        sender: string,
        elements: readonly TreeElement[],
    ): boolean {
        const content = degradeElements(elements);
        if (content === null) {
            return false; // 降级为空 = 不发
        }
        if (this.opts.commandPrefix !== "" && content.startsWith(this.opts.commandPrefix)) {
            const command = content.slice(this.opts.commandPrefix.length).trim();
            if (command === "") {
                return false; // 空命令忽略
            }
            return this.forwardCommand(channel, userId, command);
        }
        return this.sendChat(channel, sender, content);
    }

    /** 平台 → 游戏聊天（绑定过滤 + 降级 + chat 帧）。 */
    forwardChat(channel: string, sender: string, elements: readonly TreeElement[]): boolean {
        const content = degradeElements(elements);
        if (content === null) {
            return false;
        }
        return this.sendChat(channel, sender, content);
    }

    /** 群指令 → 游戏命令（pending 登记 + command 帧；不做绑定过滤，KD-04）。 */
    forwardCommand(channel: string, userId: string, command: string): boolean {
        if (command === "") {
            return false;
        }
        const id = randomUUID();
        const sent = this.connection.send({
            type: "command",
            id,
            body: { command, source: { channel, userId } },
        });
        if (!sent) {
            return false;
        }
        this.commandPending.set(id, channel);
        return true;
    }

    /** 状态/绑定查询（请求-响应按 UUID 关联；超时 reject）。 */
    query(kind: QueryKind): Promise<QueryResultBody> {
        return new Promise((resolve, reject) => {
            if (!this.connection.isEstablished()) {
                reject(new Error("未建立连接"));
                return;
            }
            const id = randomUUID();
            const timer = setTimeout(() => {
                this.queryPending.delete(id);
                reject(new Error(`query ${kind} 超时`));
            }, this.opts.queryTimeoutMs);
            this.queryPending.set(id, { resolve, reject, timer });
            const sent = this.connection.send({ type: "query", id, body: { kind } });
            if (!sent) {
                clearTimeout(timer);
                this.queryPending.delete(id);
                reject(new Error("未建立连接"));
            }
        });
    }

    /** chat 帧发送（绑定过滤在调用前完成）。 */
    private sendChat(channel: string, sender: string, content: string): boolean {
        if (!this.bindings.has(channel)) {
            this.opts.callbacks.onLog("debug", "频道未绑定，丢弃出站 chat", { channel });
            return false;
        }
        return this.connection.send({ type: "chat", body: { channel, sender, content } });
    }

    /** 握手成功：绑定快照落地。 */
    private handleEstablished(channelBindings: string[]): void {
        this.bindings = new Set(channelBindings);
        this.opts.callbacks.onLog("info", "绑定快照已更新", { channelBindings });
    }

    /** 服务端帧分发（pong 忽略；事件渲染后回调宿主；响应按 pending 关联）。 */
    private handleFrame(msg: ServerEventMessage): void {
        switch (msg.type) {
            case "pong":
                break;
            case "chat":
                this.emitGameEvent(
                    "chat",
                    renderGameEvent(
                        "chat",
                        { player: msg.body.playerName, content: msg.body.content },
                        this.opts.render,
                    ),
                    msg.body.channel,
                );
                break;
            case "join":
                this.emitGameEvent(
                    "join",
                    renderGameEvent("join", { player: msg.body.playerName }, this.opts.render),
                    msg.body.channel,
                );
                break;
            case "leave":
                this.emitGameEvent(
                    "leave",
                    renderGameEvent("leave", { player: msg.body.playerName }, this.opts.render),
                    msg.body.channel,
                );
                break;
            case "death":
                this.emitGameEvent(
                    "death",
                    renderGameEvent(
                        "death",
                        { player: msg.body.player, message: msg.body.message },
                        this.opts.render,
                    ),
                    msg.body.channel,
                );
                break;
            case "status":
                this.opts.callbacks.onStatus(msg.body);
                break;
            case "bindings_updated":
                this.handleEstablished(msg.body.channelBindings);
                break;
            case "command_result":
                this.handleCommandResult(msg.id, msg.body);
                break;
            case "query_result":
                this.handleQueryResult(msg.id, msg.body);
                break;
        }
    }

    private emitGameEvent(type: GameEventType, rendered: string, channel: string): void {
        this.opts.callbacks.onGameEvent(type, rendered, channel);
    }

    /** 命令回执：pending 路由到来源频道，渲染后经 onGameEvent 广播。 */
    private handleCommandResult(id: string, body: CommandResultBody): void {
        const channel = this.commandPending.get(id);
        this.commandPending.delete(id);
        if (channel === undefined) {
            this.opts.callbacks.onLog("debug", "command_result 无对应 pending，丢弃", { id });
            return;
        }
        this.emitGameEvent("command_result", renderCommandResult(body, this.opts.render), channel);
    }

    /** 查询回执：resolve 对应 promise。 */
    private handleQueryResult(id: string, body: QueryResultBody): void {
        const pending = this.queryPending.get(id);
        this.queryPending.delete(id);
        if (pending === undefined) {
            this.opts.callbacks.onLog("debug", "query_result 无对应 pending，丢弃", { id });
            return;
        }
        clearTimeout(pending.timer);
        pending.resolve(body);
    }

    /** 停止时清理 pending（查询统一 reject，命令回执丢弃；避免悬挂 promise/定时器）。 */
    private failAllPending(reason: string): void {
        for (const [id, pending] of this.queryPending.entries()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
            this.queryPending.delete(id);
        }
        this.commandPending.clear();
    }
}
