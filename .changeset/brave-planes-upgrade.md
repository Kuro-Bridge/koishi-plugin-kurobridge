---
"koishi-plugin-kurobridge": minor
---

feat: 协议依赖 ^0.1.0 → ^0.4.0（npm 包版本轴对齐协议版本轴，^0.1.0 的 0.x 区间接不到 0.4.0）；移除 tsdown alwaysBundle 内联绕行，产物改为运行时 require 协议包（0.4.0 exports 已含 require 条件，ADR-001 阶段 2 / KD-10 结案）；协议线格式零变化；新增包内金样本契约测试（fixtures + validateFixture + SHA256SUMS 完整性，开发面）。
