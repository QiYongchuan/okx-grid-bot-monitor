# OKX Grid Bot Monitor & Auto-Trader

> ETH 永续合约网格策略监控 + 自动调仓工具
>
> 基于 OKX Trading Bot API，支持模拟盘验证与实盘交易。

---

## 项目简介

这是一个围绕 **OKX 网格交易策略** 的自动化监控与调仓工具，核心解决一个问题：

> 当价格偏离网格区间时，自动停止旧机器人并在新价格区间重建网格，让策略始终"追得上"行情。

项目最初为 OKX 交易大赛设计，包含完整的策略验证文档、自动化脚本和监控体系。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 网格状态监控 | 每 5 分钟扫描一次，检查机器人运行状态、挂单数量、持仓盈亏 |
| 自动调仓 | 价格突破区间或横盘太久时，自动停旧 bot → 建新 bot |
| 多模式支持 | `demo`（模拟盘，可真实自动交易）/ `live`（实盘，仅监控） |
| 风控保护 | 冷却期（默认 1 小时）、日交易上限（默认 2 次）、防负价保护 |
| 日志追溯 | NDJSON 结构化日志 + 人类可读通知文件，完整可追溯 |
| Windows 计划任务 | 开箱即用的 PowerShell 脚本，一键注册定时任务 |

---

## 项目结构

```text
okx-demo/
├── scripts/
│   ├── monitor.js              # 核心监控 + 自动交易脚本（Node.js）
│   ├── run-monitor.ps1         # PowerShell 包装器（验证环境后执行）
│   ├── run-monitor.vbs         # VBS 包装器（后台无窗口运行）
│   └── setup-scheduler.ps1     # 一键注册 Windows 计划任务
├── runtime/                    # 运行时日志（gitignore，不提交）
│   ├── latest-state.json       # 最新状态快照
│   ├── monitor-log.ndjson      # 完整监控日志
│   ├── alert-log.ndjson        # 告警日志
│   ├── notifications.txt       # 人类可读通知
│   ├── auto-trade-config.json  # 自动交易配置
│   └── auto-trade-state.json   # 自动交易状态
├── data/historical/            # 历史复盘数据（参考）
├── skill/                      # 策略文档
│   ├── 01-历史证据.md
│   ├── 02-赚钱机制.md
│   ├── 03-当前市场判断.md
│   └── 04-比赛执行方案.md
├── deploy/                     # 部署相关 Skill 文档
├── README.md                   # 本文件
└── .gitignore
```

---

## 前置依赖

1. [Node.js](https://nodejs.org/) ≥ 18
2. [OKX Trade CLI](https://www.okx.com/download) (`npm install -g @okx_ai/okx-trade-cli`)
3. 已配置 CLI profile：
   ```bash
   okx --profile demo ...   # 模拟盘
   okx --profile live ...   # 实盘
   ```

---

## 快速开始

### 1. 安装依赖

确保全局安装 OKX CLI：

```bash
npm install -g @okx_ai/okx-trade-cli
```

### 2. 配置自动交易（可选）

编辑 `runtime/auto-trade-config.json`：

```json
{
  "enabled": true,
  "targetInstId": "ETH-USDT-SWAP",
  "targetBot": "first",
  "triggers": {
    "aboveBy": 50,           # 价格超出区间上限 50 USDT 时触发上移
    "belowBy": 50,           # 价格跌破区间下限 50 USDT 时触发下移
    "noLiveOrdersChecks": 12  # 连续 12 次无活跃挂单（60分钟）触发横盘重建
  },
  "newBot": {
    "gridNum": 12,           # 网格数量
    "lever": 2,              # 杠杆倍数
    "sz": 200,               # 单格投资额
    "direction": "long",     # 做多方向
    "rangeHalfWidth": 100    # 新区间半宽（当前价 ±100）
  },
  "cooldownMs": 3600000,     # 交易冷却期：1 小时
  "maxDailyTrades": 2        # 日交易上限
}
```

### 3. 运行监控

```bash
# 模拟盘模式（默认，支持自动交易）
node scripts/monitor.js

# 模拟盘 + 只看不交易
node scripts/monitor.js --dry-run

# 实盘模式（仅监控，不自动交易）
node scripts/monitor.js --live
```

### 4. 注册 Windows 定时任务

```powershell
# 以管理员身份运行 PowerShell
.\scripts\setup-scheduler.ps1

# 查看任务状态
Get-ScheduledTask -TaskName 'OKX-Grid-Monitor-Demo'

# 立即执行一次
Start-ScheduledTask -TaskName 'OKX-Grid-Monitor-Demo'

# 移除任务
.\scripts\setup-scheduler.ps1 -Remove
```

---

## 自动交易触发逻辑

```
每 5 分钟检查一次：
├─ 价格 > 区间上限 + aboveBy   → 触发上移重建
├─ 价格 < 区间下限 - belowBy   → 触发下移重建
└─ 区间内但 N 次无活跃挂单    → 触发横盘重建

触发后检查安全阀：
├─ 冷却期是否已过？
├─ 当日交易次数是否 < maxDailyTrades？
└─ 新区间价格是否为正？

全部通过 → 执行：停旧 bot → 建新 bot
```

---

## 日志说明

| 文件 | 格式 | 说明 |
|------|------|------|
| `latest-state.json` | JSON | 最新一次检查的快照（覆盖） |
| `monitor-log.ndjson` | NDJSON | 所有检查记录（追加） |
| `alert-log.ndjson` | NDJSON | 仅告警记录（追加） |
| `notifications.txt` | 文本 | 人类可读通知（追加） |

---

## 风险提示

⚠️ **本项目仅供学习研究，不构成投资建议。**

- 模拟盘（`demo`）模式下，自动交易也是真实的模拟交易，会产生模拟盈亏。
- 实盘（`live`）模式默认**关闭**自动交易，仅作监控，需手动修改代码开启。
- 网格策略在**单边行情**中会亏损，请确保理解策略原理后再使用。
- 建议先用模拟盘跑至少 3 个完整往返（买→卖→利润确认）验证策略有效性。

---

## 技术栈

- **Node.js** — 核心脚本
- **PowerShell** — Windows 环境集成
- **OKX Trade CLI** — 与 OKX API 交互
- **Windows Task Scheduler** — 定时触发

---

## 作者

- **我真的没有拼多多**（X: [我真的没有拼多多](https://x.com/nopinduoduo)）
- AI 搭档：AI_kevin

---

## License

MIT License — 自由使用，风险自负。
