import { defineConfig } from "tsdown";

// 源码保持 ESM（package.json 为 type:module，tsconfig/编辑器按 ESM 解析）；
// 构建产物固定为 CJS（.cjs 扩展名）：Node 宿主的 loader 用 require() 加载插件，
// Bun 宿主的 require(esm) 对 CJS 同样兼容，CJS 是两类宿主的最大公约数。
const outExtensions = () => ({ js: ".cjs", dts: ".d.ts" });

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "lib",
    dts: true,
    format: "cjs",
    platform: "node",
    outExtensions,
    clean: true,
    deps: {
        // 依赖全部 external（koishi 为 peer 单实例），不打进产物。
        bundle: false,
        dts: {
            // koishi 生态 d.ts 用 CJS dts 语法（export = Element）或 namespace 成员
            // re-export，dts 打包无法解析 → 生成 d.ts 时保持外部引用
            // （产物 d.ts 保留 import，消费端由 koishi 提供类型）。
            neverBundle: [/^koishi/, /^@satorijs\//, /^@koishijs\//, /^cordis/, /^minato/, /^cosmokit/],
        },
    },
});
