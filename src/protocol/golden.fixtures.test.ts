/**
 * 金样本契约测试 —— 消费 `@kuro-bridge/protocol` 发布件包内 fixtures/v0.4 金样本
 *
 * 0.4.0 起发布件自带金样本夹具（fixtures 不经 exports 暴露，消费方式=文件读取）：
 * 版本目录轴与 PROTOCOL_VERSION 对齐、全量夹具逐个通过包导出的 validateFixture
 * 契约校验（ADR-002 选 C）、SHA256SUMS 清单双向完整性。上游金样本漂移此处立即红。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, validateFixture } from "./index.js";

// 包根定位：require.resolve 走 exports 的 require 条件 → <包根>/dist/index.cjs，
// 从入口文件路径上溯两级（index.cjs → dist → 包根）。
const entryPath = createRequire(import.meta.url).resolve("@kuro-bridge/protocol");
const packageRoot = resolve(entryPath, "../..");
const fixturesRoot = join(packageRoot, "fixtures");
// 版本目录 = v<major.minor>（协议版本轴以 major.minor 对齐，patch 共目录）。
const versionDir = `v${PROTOCOL_VERSION.split(".").slice(0, 2).join(".")}`;
const fixturesDir = join(fixturesRoot, versionDir);

/** 递归枚举目录下全部文件（返回相对 dir 的 POSIX 风格路径）。 */
function listFilesRel(dir: string, rel = ""): string[] {
    const files: string[] = [];
    const entries = readdirSync(rel === "" ? dir : join(dir, rel), { withFileTypes: true });
    for (const entry of entries) {
        const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            files.push(...listFilesRel(dir, relPath));
        } else {
            files.push(relPath);
        }
    }
    return files;
}

describe("包内金样本 fixtures/v0.4 契约（KD-10 结案后随包消费）", () => {
    it("版本目录对齐：fixtures 版本轴 ≡ PROTOCOL_VERSION 的 major.minor", () => {
        expect(basename(fixturesDir)).toBe(versionDir);
        const dirs = readdirSync(fixturesRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        expect(dirs, `fixtures 根下应只有当前版本目录 ${versionDir}`).toEqual([versionDir]);
    });

    it("全量夹具逐个通过 validateFixture 契约校验（≥16 份）", () => {
        const jsonFiles = listFilesRel(fixturesDir).filter((rel) => rel.endsWith(".json"));
        expect(
            jsonFiles.length,
            "金样本 JSON 总数不应少于发布件声称的 16 份",
        ).toBeGreaterThanOrEqual(16);
        for (const rel of jsonFiles) {
            const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, rel), "utf8"));
            const result = validateFixture(raw);
            if (!result.ok) {
                throw new Error(`金样本 ${rel} 未通过契约校验：${result.issues.join("；")}`);
            }
            expect(result.ok).toBe(true);
        }
    });

    it("SHA256SUMS 双向完整性：清单逐条实算匹配，盘上文件全部被列出", () => {
        const sumsRel = "SHA256SUMS";
        const lines = readFileSync(join(fixturesDir, sumsRel), "utf8")
            .split(/\r?\n/)
            .filter((line) => line.trim() !== "");
        const listed = new Set<string>();
        for (const line of lines) {
            const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
            if (match === null) {
                throw new Error(`SHA256SUMS 行格式异常（应为 "<hex>  <相对路径>"）：${line}`);
            }
            const hex = match[1];
            const relPath = match[2];
            if (hex === undefined || relPath === undefined) {
                throw new Error(`SHA256SUMS 行格式异常（应为 "<hex>  <相对路径>"）：${line}`);
            }
            const abs = join(fixturesDir, relPath);
            expect(existsSync(abs), `SHA256SUMS 列出但盘上缺失：${relPath}`).toBe(true);
            const actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
            expect(actual, `SHA256 实算不匹配：${relPath}`).toBe(hex);
            listed.add(relPath);
        }
        const onDisk = listFilesRel(fixturesDir).filter((rel) => rel !== sumsRel);
        const unlisted = onDisk.filter((rel) => !listed.has(rel));
        expect(unlisted, `盘上存在但未被 SHA256SUMS 列出：${unlisted.join("、")}`).toEqual([]);
    });
});
