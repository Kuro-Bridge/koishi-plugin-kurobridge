/**
 * Koishi 装配层（任务书 M5）——适配核心与 Koishi 宿主的唯一粘合处。
 *
 * 配置经 Schema 声明（控制台可编辑）；hello 身份按 KD-03：peerId = config.name、
 * platform 固定 koishi、version = 插件包版本（运行时解析，失败退 unknown + warn）、
 * client 缺省 koishi-plugin-kurobridge/<版本>。入站挂 ctx.on("message")（KD-06，
 * 不占 middleware）；自过滤 userId === selfId（KD-05）；游戏事件经 ctx.broadcast
 * 单频道广播（帧内 channel 即路由目标）；dispose → adapter.stop()。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Context, Schema, type Session } from "koishi";
import { KurobridgeAdapter } from "./adapter.js";
import type { KurobridgeHello } from "./connection.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { DEFAULT_MAX_MESSAGE_LENGTH, DEFAULT_TEMPLATES } from "./translate.js";

export const name = "kurobridge";

/**
 * 依赖注入声明：广播（游戏事件 → 平台）经 broadcastDatabase 走频道表，需要 database
 * 服务；optional——无数据库的部署仍可跑平台 → 游戏方向（广播侧跳过并打日志）。
 */
export const inject = { database: "optional" };

export interface Config {
    /** KuroBridge 服务端地址（ws:// 或 wss://）。 */
    url: string;
    /** 鉴权 token（服务端配置非空 token 时必须一致，否则 close 1008）。 */
    token: string;
    /** 对端实例标识（hello.peerId，日志辨识用）。 */
    name: string;
    /** 自报身份串（缺省运行时算 koishi-plugin-kurobridge/<版本>）。 */
    client?: string;
    /** 命令前缀（前缀开头 → 游戏命令，不再作为聊天发送）。 */
    commandPrefix: string;
    /** 应用层心跳间隔毫秒（须显著小于服务端 30s 空闲阈值）。 */
    pingIntervalMs: number;
    /** MC 聊天渲染模板（占位符 {player}/{content}）。 */
    chatTemplate: string;
    /** 玩家进服渲染模板。 */
    joinTemplate: string;
    /** 玩家退服渲染模板。 */
    leaveTemplate: string;
    /** 玩家死亡渲染模板（占位符 {player}/{message}）。 */
    deathTemplate: string;
    /** § 色码剥离（色码在多数聊天端显示为乱码）。 */
    stripColorCodes: boolean;
    /** 出站文本长度上限（UTF-16 码元，超长截断）。 */
    maxMessageLength: number;
}

export const Config: Schema<Config> = Schema.object({
    url: Schema.string()
        .required()
        .description(
            "KuroBridge 服务端地址（ws:// 或 wss://，见 MC 侧 plugins/kurobridge/config.json 的 ws 段）",
        ),
    token: Schema.string().default("").description("鉴权 token（服务端配置非空 token 时必须一致）"),
    name: Schema.string().default("koishi").description("对端实例标识（hello.peerId，日志辨识用）"),
    client: Schema.string().description("自报身份串（缺省 koishi-plugin-kurobridge/<版本>）"),
    commandPrefix: Schema.string()
        .default("/")
        .description("命令前缀（前缀开头 → 游戏命令，不再作为聊天发送）"),
    pingIntervalMs: Schema.number()
        .default(15000)
        .role("ms")
        .description("应用层心跳间隔（服务端空闲阈值 30s，须显著小于）"),
    chatTemplate: Schema.string()
        .default(DEFAULT_TEMPLATES.chat)
        .description("MC 聊天模板（{player}/{content}）"),
    joinTemplate: Schema.string()
        .default(DEFAULT_TEMPLATES.join)
        .description("玩家进服模板（{player}）"),
    leaveTemplate: Schema.string()
        .default(DEFAULT_TEMPLATES.leave)
        .description("玩家退服模板（{player}）"),
    deathTemplate: Schema.string()
        .default(DEFAULT_TEMPLATES.death)
        .description("玩家死亡模板（{player}/{message}）"),
    stripColorCodes: Schema.boolean()
        .default(true)
        .description("剥离 § 色码（多数聊天端显示为乱码）"),
    maxMessageLength: Schema.number()
        .default(DEFAULT_MAX_MESSAGE_LENGTH)
        .description("出站文本长度上限（超长截断）"),
});

/** best-effort 读取本插件包版本（src 开发态与 lib CJS 产物相对包根路径一致）。 */
function resolvePackageVersion(): string | null {
    try {
        const file =
            typeof __filename === "string"
                ? join(dirname(__filename), "..", "package.json")
                : new URL("../package.json", import.meta.url);
        const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
        if (typeof pkg.version === "string" && pkg.version !== "") {
            return pkg.version;
        }
        return null;
    } catch {
        return null;
    }
}

export function apply(ctx: Context, config: Config): void {
    const logger = ctx.logger("kurobridge");
    const version = resolvePackageVersion();
    if (version === null) {
        logger.warn("运行时取不到插件包版本，hello.version/client 以退化值上报");
    }
    let client = config.client;
    if (client === undefined) {
        client =
            version === null ? "koishi-plugin-kurobridge" : `koishi-plugin-kurobridge/${version}`;
    }

    const hello: KurobridgeHello = {
        peerId: config.name,
        platform: "koishi",
        version: version ?? "unknown",
        protocolVersion: PROTOCOL_VERSION,
    };
    if (config.token !== "") {
        hello.token = config.token;
    }
    if (client !== undefined) {
        hello.client = client;
    }

    const adapter = new KurobridgeAdapter({
        url: config.url,
        hello,
        commandPrefix: config.commandPrefix,
        render: {
            chatTemplate: config.chatTemplate,
            joinTemplate: config.joinTemplate,
            leaveTemplate: config.leaveTemplate,
            deathTemplate: config.deathTemplate,
            stripColorCodes: config.stripColorCodes,
            maxMessageLength: config.maxMessageLength,
        },
        pingIntervalMs: config.pingIntervalMs,
        helloTimeoutMs: 10_000,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 30_000,
        retryJitter: 0.2,
        queryTimeoutMs: 10_000,
        callbacks: {
            onLog: (level, msg, extra) => {
                if (extra === undefined) {
                    logger[level](msg);
                } else {
                    logger[level](msg, extra);
                }
            },
            onGameEvent: (_type, rendered, channel) => {
                // 帧内 channel 为绑定表裸标识（如 QQ 群号）；koishi broadcast 按
                // `platform:id` 限定路由（broadcastDatabase 语义），对每个在线 bot
                // 平台各拼一个目标。
                const targets = [
                    ...new Set(
                        ctx.bots
                            .filter((bot) => bot.platform !== undefined && bot.platform !== "")
                            .map((bot) => `${bot.platform}:${channel}`),
                    ),
                ];
                if (targets.length === 0) {
                    return; // 无 bot 在线（无处可投）
                }
                const database = ctx.database as unknown;
                if (database === undefined || database === null) {
                    logger.warn("无数据库服务，跳过游戏事件广播（如需双向互通请启用数据库插件）");
                    return;
                }
                logger.warn("M7-DEBUG onGameEvent", { channel, targets, rendered });
                const p = ctx.broadcast(targets, rendered);
                p.then(
                    (ids) => logger.warn("M7-DEBUG broadcast resolved", { ids }),
                    (err) => logger.warn("M7-DEBUG broadcast rejected", { err: String(err) }),
                );
            },
            onStatus: (status) => {
                logger.info("服务器状态", {
                    tps: status.tps,
                    onlinePlayers: status.onlinePlayers,
                    uptimeSeconds: status.uptimeSeconds,
                });
            },
        },
    });

    ctx.on("message", (session: Session) => {
        const channel = session.channelId;
        const userId = session.userId;
        if (channel === undefined || userId === undefined) {
            return; // 私聊/无频道上下文
        }
        if (userId === session.selfId) {
            return; // bot 自身消息（KD-05 防环）
        }
        adapter.handleInbound(channel, userId, session.username ?? userId, session.elements ?? []);
    });

    ctx.on("dispose", () => adapter.stop());

    adapter.start();
}
