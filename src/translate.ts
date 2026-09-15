/**
 * 翻译层纯函数（任务书 M3）——平台渲染唯一归属（ADR-018）。
 *
 * 入站（平台→MC）：Koishi 元素树降级为单行文本（无法表达的类型静默跳过，
 * 空白返回 null = 不发——协议要求 content 非空）。
 * 出站（MC→平台）：四模板占位符渲染（{player}/{content}/{message}，缺省变量代空串、
 * 未知占位符原样保留）+ § 色码剥离（配置开关）+ 长度截断（UTF-16 码元）。
 *
 * 不 import koishi（KD-08）：TreeElement 是 Koishi `h` 元素的最小结构面
 * （type/attrs/children，text 内容承载在 attrs.content），装配层直接传
 * session.elements 即结构匹配。
 */
import type { CommandResultBody } from "./protocol/index.js";

/** Koishi 元素树最小结构面（h 元素的结构子集；M5 装配传 session.elements）。 */
export interface TreeElement {
    type: string;
    attrs: Record<string, unknown>;
    children: TreeElement[];
}

/** 模板占位符全集（chat 用 content、death 用 message；player 四类通用）。 */
export const TEMPLATE_PLACEHOLDERS = ["player", "content", "message"] as const;

/** 出站渲染缺省（对齐 napuketto，KD-07）。 */
export const DEFAULT_TEMPLATES = {
    chat: "[{player}] {content}",
    join: "{player} 加入了服务器",
    leave: "{player} 离开了服务器",
    death: "{player} {message}",
} as const;

/** 出站文本长度上限缺省（napuketto 同值）。 */
export const DEFAULT_MAX_MESSAGE_LENGTH = 1500;

/** 截断追加的省略标记。 */
const TRUNCATE_SUFFIX = "…(截断)";

/** § 色码（§+0-9/a-f/k-o/r，MC legacy 格式化码）。 */
const COLOR_CODE_PATTERN = /§[0-9a-fk-or]/g;

/** 出站渲染选项（M5 由插件配置注入；M4 适配层透传）。 */
export interface RenderOptions {
    chatTemplate: string;
    joinTemplate: string;
    leaveTemplate: string;
    deathTemplate: string;
    stripColorCodes: boolean;
    maxMessageLength: number;
}

/** 游戏事件四类（服务端事件帧的渲染分发表）。 */
export type GameEventKind = "chat" | "join" | "leave" | "death";

/** 渲染模板变量（player 必有；content = 聊天内容；message = 死亡消息）。 */
export interface TemplateVars {
    player: string;
    content?: string;
    message?: string;
}

// ---- 入站：平台 → MC（元素树降级） ----

/** 取字符串属性（动态 key 同时绕开 tsc 点访问禁令与 biome 字面量点号建议的规则冲突）。 */
function attrString(el: TreeElement, key: string): string | undefined {
    const value = el.attrs[key];
    return typeof value === "string" ? value : undefined;
}

/** at 元素 → 文本占位（@全体成员 / @{name ?? id}）。 */
function atToText(el: TreeElement): string {
    const id = attrString(el, "id");
    if (id === "all") {
        return "@全体成员";
    }
    const name = attrString(el, "name");
    return `@${name !== undefined && name !== "" ? name : (id ?? "")}`;
}

/** 元素树 → 降级文本（深序遍历；空白返回 null = 不发）。 */
export function degradeElements(elements: readonly TreeElement[]): string | null {
    const parts: string[] = [];
    const walk = (list: readonly TreeElement[]): void => {
        for (const el of list) {
            switch (el.type) {
                case "text": {
                    const content = attrString(el, "content");
                    if (content !== undefined) {
                        parts.push(content);
                    }
                    break;
                }
                case "at":
                    parts.push(atToText(el));
                    break;
                case "img":
                case "image":
                    parts.push("[图片]");
                    break;
                case "face":
                    parts.push("[表情]");
                    break;
                case "quote":
                case "reply":
                    // 引用内容不再展开（子树是被人引用的消息，非本条发言）
                    parts.push("[回复]");
                    break;
                case "br":
                    parts.push("\n");
                    break;
                case "p":
                    walk(el.children);
                    break;
                case "audio":
                case "video":
                case "voice":
                case "file":
                case "forward":
                case "node":
                case "message":
                    // 音视频/文件/转发类：无法降级为文本，静默跳过
                    break;
                default:
                    // 未知容器元素容忍：递归子树（对齐未知帧容忍的协商安全网思路）
                    walk(el.children);
                    break;
            }
        }
    };
    walk(elements);
    const text = parts.join("").trim();
    return text === "" ? null : text;
}

// ---- 出站：MC → 平台（模板渲染 + 色码剥离 + 截断） ----

/** § 色码剥离（`§[0-9a-fk-or]`；色码在多数聊天端显示为乱码，KD-07 缺省开）。 */
export function stripColorCodes(text: string): string {
    return text.replaceAll(COLOR_CODE_PATTERN, "");
}

/** 超长截断（按 UTF-16 码元计，超限部分丢弃并追加省略标记）。 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}${TRUNCATE_SUFFIX}`;
}

/** 渲染模板：替换 {player}/{content}/{message}（缺省变量代空串，未知占位符原样保留）。 */
export function renderTemplate(template: string, vars: TemplateVars): string {
    return template
        .replaceAll("{player}", vars.player)
        .replaceAll("{content}", vars.content ?? "")
        .replaceAll("{message}", vars.message ?? "");
}

/** 出站统一后处理：色码剥离（开关）→ 截断。 */
function finalize(text: string, opts: RenderOptions): string {
    const stripped = opts.stripColorCodes ? stripColorCodes(text) : text;
    return truncateText(stripped, opts.maxMessageLength);
}

/**
 * 游戏事件 → 平台文本（chat/join/leave/death 四模板；death 的 message 空串以
 * 「死亡了」代入——Bukkit deathMessage 为 null 时服务端以空串兜底）。
 */
export function renderGameEvent(
    kind: GameEventKind,
    vars: TemplateVars,
    opts: RenderOptions,
): string {
    let template: string;
    let resolved: TemplateVars;
    switch (kind) {
        case "chat":
            template = opts.chatTemplate;
            resolved = vars;
            break;
        case "join":
            template = opts.joinTemplate;
            resolved = vars;
            break;
        case "leave":
            template = opts.leaveTemplate;
            resolved = vars;
            break;
        case "death":
            template = opts.deathTemplate;
            resolved = {
                player: vars.player,
                message:
                    vars.message === "" || vars.message === undefined ? "死亡了" : vars.message,
            };
            break;
    }
    return finalize(renderTemplate(template, resolved), opts);
}

/** command_result body → 平台文本（ok 合并 output；error → 命令失败：{error}；同过剥离+截断）。 */
export function renderCommandResult(body: CommandResultBody, opts: RenderOptions): string {
    let text: string;
    if (!body.ok) {
        text = `命令失败：${body.error}`;
    } else {
        const output = body.output ?? [];
        text = output.length === 0 ? "（命令执行成功，无输出）" : output.join("\n");
    }
    return finalize(text, opts);
}
