# OKX Agent Skill 初始化说明书

## 1. 这个项目是做什么的
这个项目用于把一套已经验证过的 ETH 网格策略，整理成一个可接入 Agent Trade Kit 的 AI Skill。

当前目标不是研究所有币，而是优先完成比赛接入闭环：

- 用本地历史数据证明策略为什么有效
- 用本地脚本生成参数、判断状态
- 产出最终的 `SKILL.md`
- 上传到 Agent Trade Kit
- 由 Agent Trade Kit 自动执行 USDT 永续合约订单

---

## 2. 当前版本的 Skill 定位
当前版本定位为：

**ETH 单币震荡网格 Skill**

特点：
- 只做 ETH
- 只做震荡网格
- 不是趋势追踪系统
- 不是自动多币轮动系统
- 只有在震荡条件满足时才运行
- 不满足时 PAUSE
- 必要时 REBUILD

---

## 3. 项目目录结构说明

建议目录如下：

```text
OKX/
├─ data-export/                 # 从 OKX 导出的原始数据、主账本、K线、对账结果
├─ scripts/                     # 数据导出、行情抓取、候选币扫描等脚本
└─ reports/                     # 历史复盘报告、对账报告、覆盖检查

Agent/
├─ uploads/                     # 准备上传到 Agent Trade Kit 的文件
├─ runtime/                     # Agent 运行状态、执行日志、快照
└─ handoff/                     # 给 Agent / Claude / Codex 的交接文档

Skill/
├─ SKILL.md                     # 最终上传到 Agent Trade Kit 的比赛版 Skill 文件
├─ 00-README-中文说明.md         # 本说明文档
├─ 01-历史证据.md               # 为什么这套策略有效
├─ 02-赚钱机制.md               # 赚钱路径、胜利条件
├─ 03-当前市场判断.md           # 当前状态评估
├─ 04-比赛执行方案.md           # 当前参数、执行规则、风控
├─ skill-api-example-final.json
└─ parameter-proposal-final.json