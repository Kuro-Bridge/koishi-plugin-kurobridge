---
"koishi-plugin-kurobridge": minor
---

连接层 `KurobridgeConnection`（M2）：kurobridge-ws 客户端状态机（子协议握手 / hello-ack 关联 / 应用层心跳 / 感知 close code 的指数退避重连 ±20% 抖动 / 未知帧容忍 / 三类永久停），假服务端测试 12 例。
