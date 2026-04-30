---
name: eth-oscillation-grid-bot-grid
description: "【demo最新版】ETH-USDT-SWAP 震荡网格策略 | AI负责判断是否开网格，OKX bot grid负责自动维护网格"
license: MIT
metadata:
  author: AI_kevin
  version: "2.0.0"
  profile: demo
  agent:
    requires:
      bins: ["okx"]
---

# ETH 震荡网格 AI Skill v2.0 【demo / bot grid版】

> 本版替换掉旧版 Step 4.2 的人工补单维护逻辑。
> `bot grid` 是 OKX 官方提供的服务端网格机器人，本质上是“官方执行器”。
> 它不负责判断市场，只负责把网格自动跑起来。
> 现在的分工是：
> - AI Skill 负责判断“开不开网格、何时暂停、何时重建”
> - OKX 官方 `bot grid` 负责“挂单、补单、循环维护”

## 核心结论

旧版 v0 的问题不在策略，而在执行层：
- Skill 里写了 Step 4.2（买后挂卖、卖后补买）
- 但运行脚本没有稳定完整执行，导致出现 `LOW_ORDER_COUNT` 缺单问题

本版的核心改动：
- 不再自己维护 Step 4.2
- 改用 OKX Agent Trade Kit 官方内置的 `bot grid` 执行网格维护

这意味着：
- 不再依赖本地脚本补单
- 不再依赖 Claude 会话持续在线
- 网格挂单与补单由 OKX 服务端完成

---

## 历史成功样本（证据层，不变）

| 指标 | 数值 |
|------|------|
| 标的 | ETH-USDT 现货网格 |
| 运行时长 | 9.1 天 |
| 历史区间 | 1900 - 2200 USDT |
| 总成交 | 100 fills（策略统计112） |
| 已解释往返 | 48 次 |
| 正常网格利润 | 28 次 |
| 已解释利润 | 37.0272 USDT |

结论不变：
- 震荡行情适合网格
- 高杠杆会破坏盈利
- 低杠杆 + 缓冲资金 + 暂停机制是核心

---

## 当前正式参数（策略层）

| 参数 | 值 |
|------|-----|
| 标的 | ETH-USDT-SWAP |
| 执行区间 | 2036 - 2346 |
| 网格数 | 6 格 |
| 网格线 | 2036 / 2088 / 2140 / 2191 / 2243 / 2295 / 2346 |
| 主执行阈值 | oscillation_score >= 45 |
| 高质量参考 | >= 60 |
| 杠杆 | 2x isolated |
| 资金上限 | 65% |
| 缓冲资金 | 35% |

注意：
- 每格 0.03 ETH 是我们原始人工挂单版本的仓位表达
- 在 `bot grid create` 中，`--sz` 是总投入资金/保证金口径，不是“每格张数”
- 按我们原始仓位换算：每格约 32.85 USDT 保证金，6 格约 197.1 USDT
- 因此 bot grid 版固定使用：`--sz 200`
- 这代表整套网格总投入资金约 200 USDT，而不是逐格 `sz=0.3`

---

## Step 1：采集市场状态

```bash
okx --profile demo market ticker ETH-USDT-SWAP
okx --profile demo market candles ETH-USDT-SWAP --bar 1H --limit 48
okx --profile demo market candles ETH-USDT-SWAP --bar 4H --limit 30
okx --profile demo account balance
okx --profile demo bot grid orders --algoOrdType contract_grid
```

---

## Step 2：判断是否适合开网格

必须同时满足：

| 条件 | 阈值 |
|------|------|
| oscillation score | >= 45 |
| 1h stay ratio | >= 40% |
| boundary hit ratio | <= 70% |
| grid spacing | >= fee × 4 |
| capital usage | <= 65% |

输出：
- `RUNNING`：允许开网格
- `PAUSE`：暂停，不开
- `REBUILD`：旧区间失效，需要重建

---

## Step 3：确认参数

```text
instId       = ETH-USDT-SWAP
minPx        = 2036
maxPx        = 2346
gridNum      = 6
direction    = long
lever        = 2
algoOrdType  = contract_grid
```

bot grid 版新增说明：
- 需要单独确认 `--sz` 的总投入资金口径
- demo 测试已确认 `contract_grid` 命令可成功创建机器人
- 但正式投入资金应单独按总保证金预算确定

---

## Step 4：执行决策（新版）

### 4.1 首次部署 / 重建

当 `state = RUNNING` 时，不再逐格手动挂单，而是直接创建官方网格机器人：

```bash
okx --profile demo bot grid create \
  --instId ETH-USDT-SWAP \
  --algoOrdType contract_grid \
  --maxPx 2346 \
  --minPx 2036 \
  --gridNum 6 \
  --direction long \
  --lever 2 \
  --sz 200
```

说明：
- `TOTAL_MARGIN_USDT` 表示这套网格的总投入资金
- 不是每格张数
- demo 中已验证：命令可创建成功，state=running

### 4.2 网格循环维护

**本版不再由本地脚本维护。**

由 OKX `bot grid` 自动完成：
- 买单成交后自动补卖单
- 卖单成交后自动补买单
- 自动维持网格完整性

这正是本版替换旧版 v0 的核心价值。

### 4.3 查询与核对

```bash
okx --profile demo bot grid orders --algoOrdType contract_grid
okx --profile demo bot grid details --algoOrdType contract_grid --algoId <algoId>
okx --profile demo bot grid sub-orders --algoOrdType contract_grid --algoId <algoId> --live
```

---

## Step 5：暂停与停止

当状态变为 `PAUSE` 或 `REBUILD` 时：

```bash
okx --profile demo bot grid stop --algoId <algoId> --algoOrdType contract_grid --instId ETH-USDT-SWAP --stopType 1
```

说明：
- `stopType` 的具体使用在 live 前再确认
- 核心是：暂停不再需要逐一取消挂单，而是直接停止机器人

---

## Step 6：监控与复盘

继续保留本地监控，但职责简化为“只读监控”：
- 读取 bot 状态
- 记录 pnl
- 记录运行状态
- 读取通知与快照

重点文件：
- `runtime/latest-state.json`
- `runtime/monitor-log.ndjson`
- `runtime/alert-log.ndjson`
- `runtime/notifications.txt`

---

## 结论

v2 相比 v0 的根本变化不是参数变化，而是：

**把网格维护从“自己补单”改成“OKX 官方 bot grid 自动维护”。**

所以：
- 我们的 Skill 仍然有价值
- 但价值从“自己造网格机器人”变成了“判断是否该启动官方网格机器人”
