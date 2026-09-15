/**
 * translate.test.ts：翻译层纯函数表驱动用例（任务书 M3）。
 *
 * 入站降级（元素树→文本）、出站渲染（四模板/色码剥离/截断）、command_result 三态。
 */
import { describe, expect, it } from "vitest";
import type { CommandResultBody } from "./protocol/index.js";
import {
    DEFAULT_MAX_MESSAGE_LENGTH,
    DEFAULT_TEMPLATES,
    degradeElements,
    type RenderOptions,
    renderCommandResult,
    renderGameEvent,
    stripColorCodes,
    type TreeElement,
    truncateText,
} from "./translate.js";

/** 测试用渲染选项（缺省值 + 可局部覆盖）。 */
function opts(overrides?: Partial<RenderOptions>): RenderOptions {
    return {
        chatTemplate: DEFAULT_TEMPLATES.chat,
        joinTemplate: DEFAULT_TEMPLATES.join,
        leaveTemplate: DEFAULT_TEMPLATES.leave,
        deathTemplate: DEFAULT_TEMPLATES.death,
        stripColorCodes: true,
        maxMessageLength: DEFAULT_MAX_MESSAGE_LENGTH,
        ...overrides,
    };
}

/** 构树便捷函数。 */
function el(
    type: string,
    attrs: Record<string, unknown> = {},
    children: TreeElement[] = [],
): TreeElement {
    return { type, attrs, children };
}

function text(content: string): TreeElement {
    return el("text", { content });
}

describe("degradeElements（平台 → MC 元素树降级）", () => {
    it.each([
        {
            name: "纯文本",
            input: [text("你好 MC")],
            expected: "你好 MC",
        },
        {
            name: "文本 + at(name)",
            input: [text("喂 "), el("at", { id: "10001", name: "小明" }), text(" 看这边")],
            expected: "喂 @小明 看这边",
        },
        {
            name: "at 无 name 退 id",
            input: [el("at", { id: "10001" })],
            expected: "@10001",
        },
        {
            name: "at all → @全体成员",
            input: [el("at", { id: "all" })],
            expected: "@全体成员",
        },
        {
            name: "img / image → [图片]",
            input: [
                text("图："),
                el("img", { url: "https://x/1.png" }),
                el("image", { url: "https://x/2.png" }),
            ],
            expected: "图：[图片][图片]",
        },
        {
            name: "face → [表情]",
            input: [el("face", { id: "14" })],
            expected: "[表情]",
        },
        {
            name: "quote / reply → [回复]（引用子树不展开）",
            input: [
                el("quote", { id: "99" }, [text("被引用的内容")]),
                text("回复你"),
                el("reply", { id: "98" }),
            ],
            expected: "[回复]回复你[回复]",
        },
        {
            name: "br → 换行",
            input: [text("第一行"), el("br"), text("第二行")],
            expected: "第一行\n第二行",
        },
        {
            name: "p 递归 children",
            input: [el("p", {}, [text("段落"), el("p", {}, [text("嵌套")])])],
            expected: "段落嵌套",
        },
        {
            name: "音视频/文件/转发类静默跳过",
            input: [
                text("前"),
                el("audio", { url: "https://x/a.mp3" }),
                el("video", { url: "https://x/v.mp4" }),
                el("voice", { url: "https://x/w.silk" }),
                el("file", { url: "https://x/f.zip" }),
                el("forward", {}, [text("转发内容")]),
                el("node", {}, [text("节点内容")]),
                el("message", {}, [text("合并转发")]),
                text("后"),
            ],
            expected: "前后",
        },
        {
            name: "未知容器元素递归子树",
            input: [el("custom_container", {}, [text("内 "), el("at", { id: "7" })])],
            expected: "内 @7",
        },
        {
            name: "空白前后 trim",
            input: [text("  hi  ")],
            expected: "hi",
        },
    ])("$name", ({ input, expected }) => {
        expect(degradeElements(input)).toBe(expected);
    });

    it.each([
        { name: "空树", input: [] },
        { name: "只有跳过类元素", input: [el("video", { url: "https://x/v.mp4" })] },
        { name: "只有空白文本", input: [text("   \n  ")] },
    ])("$name → null 不发", ({ input }) => {
        expect(degradeElements(input)).toBeNull();
    });
});

describe("renderGameEvent（MC → 平台模板渲染）", () => {
    it("四类默认模板", () => {
        expect(renderGameEvent("chat", { player: "Steve", content: "大家好" }, opts())).toBe(
            "[Steve] 大家好",
        );
        expect(renderGameEvent("join", { player: "Alex" }, opts())).toBe("Alex 加入了服务器");
        expect(renderGameEvent("leave", { player: "Alex" }, opts())).toBe("Alex 离开了服务器");
        expect(
            renderGameEvent(
                "death",
                { player: "Steve", message: "Steve fell from a high place" },
                opts(),
            ),
        ).toBe("Steve Steve fell from a high place");
    });

    it("death message 空串以「死亡了」代入", () => {
        expect(renderGameEvent("death", { player: "Steve", message: "" }, opts())).toBe(
            "Steve 死亡了",
        );
    });

    it("自定义模板 + 未知占位符原样保留", () => {
        const o = opts({ chatTemplate: "<{player}> 说：{content} {foo}" });
        expect(renderGameEvent("chat", { player: "P", content: "嗨" }, o)).toBe("<P> 说：嗨 {foo}");
    });

    it("缺省变量代空串", () => {
        const o = opts({ chatTemplate: "[{player}] {content}!" });
        expect(renderGameEvent("chat", { player: "P" }, o)).toBe("[P] !");
    });

    it("§ 色码剥离（开关开）", () => {
        const o = opts();
        expect(renderGameEvent("chat", { player: "§aSteve", content: "§r你好§l粗体" }, o)).toBe(
            "[Steve] 你好粗体",
        );
    });

    it("§ 色码剥离（开关关，原样保留）", () => {
        const o = opts({ stripColorCodes: false });
        expect(renderGameEvent("chat", { player: "S", content: "§c红" }, o)).toBe("[S] §c红");
    });

    it("超长截断：超限丢弃 + …(截断) 后缀", () => {
        const o = opts({ maxMessageLength: 10 });
        // "[P] " 占 4 个 UTF-16 码元，slice(0,10) 共保留 6 个 a
        expect(renderGameEvent("chat", { player: "P", content: "a".repeat(20) }, o)).toBe(
            `[P] ${"a".repeat(6)}…(截断)`,
        );
    });

    it("恰好等于上限不截断", () => {
        expect(truncateText("a".repeat(10), 10)).toBe("a".repeat(10));
        expect(stripColorCodes("§a绿§r白")).toBe("绿白");
        expect(stripColorCodes("§x无匹配§z")).toBe("§x无匹配§z");
    });
});

describe("renderCommandResult（命令结果三态）", () => {
    it.each([
        {
            name: "ok:false → 命令失败：{error}",
            body: { ok: false, error: "forbidden" } as CommandResultBody,
            expected: "命令失败：forbidden",
        },
        {
            name: "ok:true 无 output →（命令执行成功，无输出）",
            body: { ok: true } as CommandResultBody,
            expected: "（命令执行成功，无输出）",
        },
        {
            name: "ok:true 空 output 数组 →（命令执行成功，无输出）",
            body: { ok: true, output: [] } as CommandResultBody,
            expected: "（命令执行成功，无输出）",
        },
        {
            name: "ok:true 有 output → join 换行",
            body: { ok: true, output: ["line1", "line2"] } as CommandResultBody,
            expected: "line1\nline2",
        },
    ])("$name", ({ body, expected }) => {
        expect(renderCommandResult(body, opts())).toBe(expected);
    });

    it("命令输出同样过截断与色码剥离", () => {
        const long = ["x".repeat(30)];
        expect(
            renderCommandResult({ ok: true, output: long }, opts({ maxMessageLength: 10 })),
        ).toBe(`${"x".repeat(10)}…(截断)`);
        expect(renderCommandResult({ ok: true, output: ["§a绿"] }, opts())).toBe("绿");
    });
});
