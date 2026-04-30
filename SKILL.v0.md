---
name: eth-oscillation-grid
description: "ETH-USDT-SWAP 震荡网格策略 | 先判断再执行，条件不满足则暂停"
license: MIT
metadata:
  author: 我真的没有拼多多
  version: "1.1.0"
  agent:
    requires:
      bins: ["okx"]
---

# ETH 震荡网格 AI Skill v1.1

## 策略目标

本策略用于在 ETH-USDT-SWAP 的震荡行情中，通过 AI 判断市场是否适合网格交易，并在满足条件时自动执行低杠杆、保守型的网格策略。

本策略不是趋势追踪策略，也不是全市场通用策略。  
本策略只在"震荡适配条件"满足时运行；不满足时暂停，不强行交易。

**比赛目标优先级**
1. 主目标：在固定 500 USDT 资金条件下，优先追求稳定收益率与资金使用效率
2. 次目标：在不破坏风控的前提下争取更高收益额
3. 当收益率目标与收益额目标冲突时，优先保留资金效率与风险缓冲，不为了扩大绝对收益额而增加杠杆或取消暂停机制

## 适用标的

当前仅交易：
- ETH-USDT-SWAP（USDT 永续合约）

当前版本不自动切换币种，不做多币轮动。

## 执行节奏

每 2 小时执行一次完整判断。  
若发生以下事件，则额外触发一次即时判断：
- 价格突破当前区间上沿或下沿
- 最近 24 小时边界触发比例快速升高
- 连续出现 forced exit loss
- 震荡适配分显著下降

---

## 历史成功样本（仅作证据，不作为当前执行参数）

> 本样本来自 ETH-USDT **现货**网格，用于提炼策略逻辑与胜利条件，不等同于永续合约表现。

| 指标 | 数值 |
|------|------|
| 标的 | ETH-USDT 现货网格 |
| 运行时长 | 9.1 天（2026-03-31 至 2026-04-09）|
| 历史区间 | 1900 - 2200 USDT |
| 网格数 | 8 格等差，格距 37.5 USDT |
| 单笔名义量 | 0.030881 ETH |
| 总成交 | 100 笔 fills（策略统计 112，尾差 12）|
| 已解释往返 | 48 次 |
| realized_grid_profit | 28 次（胜率 58%）|
| inventory_rebalance_exit | 8 次 |
| forced_exit_loss | 12 次 |
| startup_inventory_release | 4 次 |
| 已解释利润 | 37.0272 USDT |

**关键洞察**：Level 3（2012.5）和 Level 4（2050）为最活跃区间，合计 38% 成交。12 次 forced_exit_loss 说明高杠杆会直接摧毁盈利，低杠杆+缓冲是核心保命机制。

---

## 当前执行参数（比赛正式版）

| 参数 | 值 |
|------|-----|
| 标的 | ETH-USDT-SWAP |
| 执行区间 | 2036 - 2346 USDT |
| 网格数 | 6 格等差 |
| 格距 | 51.67 USDT（约 2.47%）|
| 网格线 | 2036 / 2088 / 2140 / 2191 / 2243 / 2295 / 2346 |
| 每格名义仓位 | 0.03 ETH → **sz = 0.3 张**（ctVal = 0.1 ETH/张）|
| 最大总持仓 | 0.18 ETH（6 格全开）|
| 杠杆 | **2x，逐仓（isolated），保守模式** |
| 总资金 | 500 USDT |
| 最大资金使用比例 | 65%（约 325 USDT）|
| 现金缓冲 | 35%（约 175 USDT）|
| 强制亏损容忍上限 | 15 USDT |

> 若后续脚本刷新市场判断，上述区间可由新 proposal 替换。1900-2200 为历史样本，不作为当前执行区间。

---

## Step 1：行情与状态采集

收集以下信息（按顺序执行）：

```bash
# 1. 当前价格与 24h 行情
okx market ticker ETH-USDT-SWAP

# 2. K 线数据（用于判断震荡状态）
okx market candles ETH-USDT-SWAP --bar 1H --limit 48
okx market candles ETH-USDT-SWAP --bar 4H --limit 30

# 3. 当前持仓快照
okx swap positions ETH-USDT-SWAP

# 4. 当前挂单列表
okx swap orders --instId ETH-USDT-SWAP

# 5. 账户余额
okx account balance

# 6. 最近成交记录
okx swap fills --instId ETH-USDT-SWAP
```

采集完成后，计算以下指标：
- oscillation score（价格在目标区间内的停留比例综合评估）
- 1h stay ratio（最近 1h 价格在候选区间内停留比例）
- boundary hit ratio（最近 24h 价格触碰边界的频率）
- grid spacing vs fee（格距是否覆盖手续费 4 倍以上）
- capital usage ratio（当前已用保证金占总资金比例）

---

## Step 2：AI 判断当前是否适合运行震荡网格

AI 需要先判断市场状态，再决定是否执行。**判断条件（全部必须满足）**：

| 条件 | 阈值 | 说明 |
|------|------|------|
| oscillation score | **>= 45** | 正式执行阈值 |
| oscillation score | >= 60 | 高质量震荡状态（参考，非阻塞条件）|
| 1h stay ratio | >= 40% | 价格必须以目标区间内停留为主 |
| boundary hit ratio | <= 70% | 边界触碰过高说明价格在贴边漂移 |
| grid spacing | >= fee × 4 | 格距必须覆盖手续费，否则空转 |
| capital usage | <= 65% | 必须保留缓冲资金 |

**判断结论输出**：

- `state = RUNNING`：所有条件满足，可以执行网格
- `state = PAUSE`：条件不满足，暂停，不下单
- `state = REBUILD`：旧区间已失效，新区间已形成，需要重建

---

## Step 3：参数确认

当 `state = REBUILD` 或首次部署时，使用当前默认提案（2036-2346）。

**检查参数合法性（禁止重建的条件，满足任一则禁止）：**
- oscillation score 不达标（< 45）
- 1h stay ratio < 40%
- boundary hit ratio > 70%
- spacing < fee × 4
- capital usage > 65%

若参数合法，则确认使用以下执行参数：

```
symbol:      ETH-USDT-SWAP
price_min:   2036
price_max:   2346
grid_count:  6
grid_lines:  [2036, 2088, 2140, 2191, 2243, 2295, 2346]
sz_per_grid: 0.3  # 张（= 0.03 ETH 名义，ctVal=0.1 ETH/张）
leverage:    2
mgnMode:     isolated
```

---

## Step 4：执行决策

**只有当 `state = RUNNING` 时，才允许执行以下操作。**

### 4.1 首次部署 / 重建网格

```bash
# Step A：设置杠杆（逐仓，2x）
okx swap leverage --instId ETH-USDT-SWAP --lever 2 --mgnMode isolated

# Step B：确认杠杆设置成功
okx swap get-leverage --instId ETH-USDT-SWAP --mgnMode isolated

# Step C：根据当前价格，只在网格线下方挂买单（开多）
# 重要：首次部署时，除非已确认存在对应 long 持仓，否则不预挂上方卖单。
# 卖单仅在对应买单成交、产生 long 持仓之后，作为平多单挂出。
# 以下为示例（当前价格约 2191 时）：

# 在 2140 挂买单（开多）
okx swap place --instId ETH-USDT-SWAP --tdMode isolated --side buy --posSide long --ordType limit --sz 0.3 --px 2140

# 在 2088 挂买单（开多）
okx swap place --instId ETH-USDT-SWAP --tdMode isolated --side buy --posSide long --ordType limit --sz 0.3 --px 2088

# 在 2036 挂买单（开多）
okx swap place --instId ETH-USDT-SWAP --tdMode isolated --side buy --posSide long --ordType limit --sz 0.3 --px 2036
```

### 4.2 网格循环维护（每格成交后触发）

```bash
# 买单成交后 → 在上一格挂卖单（平多）
okx swap place --instId ETH-USDT-SWAP --tdMode isolated --side sell --posSide long --ordType limit --sz 0.3 --px <上一格价格>

# 卖单成交后 → 在下一格重新挂买单（开多）
okx swap place --instId ETH-USDT-SWAP --tdMode isolated --side buy --posSide long --ordType limit --sz 0.3 --px <下一格价格>
```

### 4.3 查询与核对

```bash
# 查当前所有持仓
okx swap positions ETH-USDT-SWAP

# 查当前所有挂单
okx swap orders --instId ETH-USDT-SWAP

# 查最近成交记录
okx swap fills --instId ETH-USDT-SWAP
```

### 4.4 输出格式

每次执行后，必须输出：
```
状态: RUNNING / PAUSE / REBUILD
当前价格: [价格]
oscillation_score: [分数]
当前挂单数: [数量]
当前持仓: [数量] ETH-USDT-SWAP
当前浮盈亏: [USDT]
本次操作: [执行 / 暂停 / 重建]
原因: [简要说明]
```

---

## Step 5：风险控制

### 资金控制
- 最大资金使用比例：**65%（约 325 USDT）**
- 必须保留 35% 缓冲资金（约 175 USDT）
- 不允许满仓

### 杠杆控制
- **固定 2x，逐仓（isolated），保守模式**
- 不允许调高杠杆
- 不允许全仓（cross）模式

### 暂停与退出条件（满足任一则暂停）

```bash
# 触发以下任一条件时，取消所有挂单
okx swap orders --instId ETH-USDT-SWAP  # 先查出所有 ordId
okx swap cancel ETH-USDT-SWAP --ordId <ordId>  # 逐一取消
```

| 条件 | 阈值 | 动作 |
|------|------|------|
| oscillation score | < 45 | state = PAUSE |
| 1h stay ratio | < 40% | state = PAUSE |
| boundary hit ratio | > 70% | state = PAUSE |
| 累计 forced exit loss | > 15 USDT | state = PAUSE |
| 库存失衡持续 | > 6 小时 | state = PAUSE |
| 价格持续在区间外 | > 3% 且持续 2 小时 | state = REBUILD 或 STOP |

### 紧急平仓

```bash
# 紧急情况下平掉全部多仓
okx swap close --instId ETH-USDT-SWAP --mgnMode isolated --posSide long --autoCxl
```

### 风险说明

本策略不是无损系统。历史复盘已证明除正常网格盈利外，也会出现：
- forced_exit_loss（12 次 / 48 次 = 25%）
- inventory_rebalance_exit（8 次）
- startup_inventory_release（4 次）

因此本策略依赖风控与暂停机制，不可将其视为只会盈利的系统。

---

## Step 6：记录与复盘

每次执行后，必须记录以下内容。**日志由本地 runtime / scripts 目录下的配套脚本负责落盘，SKILL.md 只定义记录字段与触发条件。**

```
时间:                [ISO 时间]
状态:                RUNNING / PAUSE / REBUILD
当前价格:            [价格]
执行区间:            [min] - [max]
oscillation_score:   [分数]
stay_ratio:          [比例]
boundary_hit_ratio:  [比例]
本次操作:            [执行/暂停/重建]
原因:                [说明]
当前持仓:            [ETH 数量]
当前浮盈亏:          [USDT]
当前已实现盈亏:      [USDT]
```

这些记录用于：
- 后续复盘与参数优化
- 比赛过程证明材料
- 候选币策略比较

---

## 策略原则总结

1. 只做 ETH-USDT-SWAP 的震荡网格
2. 先判断，再执行
3. 条件不满足就暂停，不强行交易
4. 条件变化后再重建，不手工追价
5. 固定 2x 杠杆、逐仓、65% 资金上限、175 USDT 缓冲
6. 所有计榜订单必须通过 Agent Trade Kit（`okx` CLI）自动执行，不使用 OKX App 手动下单
