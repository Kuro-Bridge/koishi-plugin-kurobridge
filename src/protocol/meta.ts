/**
 * 协议元信息镜像 —— SSOT: KuroBridge `bridge/protocol/src/meta.ts`（对端可见子集）
 *
 * 镜像基线：KuroAdapter master `17be8f6`（协议 0.4.0）。
 * `@kuro-bridge/protocol` 未发布 npm（KD-01，2026-09-15 实测 Not Found），本目录为
 * napuketto 同款过渡镜像；**真包发布后仅改 `index.ts` 的再出口为包导入**。
 * golden 帧对表测试锁漂移（见 connection/adapter 测试与 KuroAdapter peer-guide）。
 *
 * 以下实现与 SSOT 逐行一致（除本头注外不做任何改写）。
 */

export const PROTOCOL_NAME = "kurobridge-ws" as const;

/**
 * 语义化版本（ADR-026：hello.protocolVersion 按主版本兼容区间协商——0.2.0 对端可连
 * 0.3.0 服务端；v0.3.0 增鉴权 token、command/query 请求族、death 事件、config_reload
 * ——DEBT-1，未知帧容忍为协商安全网；v0.3.1 增 hello 可选 client（对端自报身份，
 * MVP-3，仅日志辨识不做行为分支）；v0.4.0 品牌迁移 kurobot-ws → kurobridge-ws
 * （ADR-030：唯一 breaking 是握手子协议字符串，帧形状零变化））
 */
export const PROTOCOL_VERSION = "0.4.0" as const;

/** WS 子协议（ADR-003：大版本，握手期拒绝不兼容对端） */
export const WS_SUBPROTOCOL = "kurobridge-ws.v1" as const;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseMajor(version: string): number | null {
    const match = VERSION_PATTERN.exec(version);
    if (match === null) {
        return null;
    }
    const major = Number.parseInt(match[1] as string, 10);
    return Number.isNaN(major) ? null : major;
}

/**
 * 协议版本兼容判定（ADR-026）：主版本号相同即兼容（0.2.0 对端可连 0.3.0 服务端）。
 * 任一侧不满足语义化三元组格式 → 不兼容（hello schema 已强制格式，此处防御性兜底）。
 */
export function isProtocolVersionCompatible(peerVersion: string, serverVersion: string): boolean {
    const peer = parseMajor(peerVersion);
    const server = parseMajor(serverVersion);
    return peer !== null && server !== null && peer === server;
}
