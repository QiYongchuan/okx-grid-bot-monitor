---
name: eth-sol-oscillation-grid-demo
description: "模拟盘多币测试版 | ETH + SOL 震荡网格 | 仅限 demo profile"
license: MIT
metadata:
  author: okxrace2
  version: "demo-1.0"
  agent:
    requires:
      bins: ["okx"]
---

# 模拟盘测试版 Skill - ETH + SOL 双币网格

> ⚠️ 此文件仅用于 demo 模拟盘测试，严禁用于 live 正式账户。
> 正式版请使用 `SKILL.live.md`。

## 测试目标

1. 验证所有 CLI 命令语法正确
2. 验证买单成交 → 挂卖单的完整循环
3. 对比 ETH 和 SOL 两个币的网格表现
4. 收集数据，判断哪个币更适合正式盘

---

## 当前测试币种与参数

### ETH-USDT-SWAP
| 参数 | 值 |
|------|-----|
| 执行区间 | 2036 - 2346 USDT |
| 网格数 | 6 格等差 |
| 格距 | 51.67 USDT（2.36%）|
| 网格线 | 2036 / 2088 / 2140 / 2191 / 2243 / 2295 / 2346 |
| sz / 格 | 0.3 张（= 0.03 ETH 名义，ctVal=0.1 ETH/张）|
| 杠杆 | 2x，isolated |

### SOL-USDT-SWAP
| 参数 | 值 |
|------|-----|
| 执行区间 | 79.7 - 88.1 USDT |
| 网格数 | 6 格等差 |
| 格距 | 1.40 USDT（1.71%）|
| 网格线 | 79.7 / 81.1 / 82.5 / 83.9 / 85.3 / 86.7 / 88.1 |
| sz / 格 | 1 张（= 1 SOL 名义，ctVal=1 SOL/张）|
| 杠杆 | 2x，isolated |

---

## 监控脚本

```powershell
# 启动监控（5 分钟间隔）
.\scripts\monitor-demo.ps1
```

## 执行命令参考

```bash
# 查挂单
okx --profile demo swap orders --instId ETH-USDT-SWAP
okx --profile demo swap orders --instId SOL-USDT-SWAP

# 查持仓
okx --profile demo swap positions ETH-USDT-SWAP
okx --profile demo swap positions SOL-USDT-SWAP

# 查余额
okx --profile demo account balance

# 买单成交后：挂对应卖单（平多）
# ETH 示例：2140 买单成交后，挂 2191 卖单
okx --profile demo swap place --instId ETH-USDT-SWAP --tdMode isolated --side sell --posSide long --ordType limit --sz 0.3 --px 2191

# SOL 示例：81.1 买单成交后，挂 82.5 卖单
okx --profile demo swap place --instId SOL-USDT-SWAP --tdMode isolated --side sell --posSide long --ordType limit --sz 1 --px 82.5

# 撤单
okx --profile demo swap cancel ETH-USDT-SWAP --ordId <ordId>
```

---

## 切换正式版的条件（达到以下指标后）

- [ ] 完成 ≥ 3 次完整往返（买→卖→利润确认）
- [ ] 连续 24 小时无命令报错
- [ ] oscillation_score 稳定 >= 45
- [ ] 日志完整，runtime/monitor-demo.log 可追溯
- [ ] ETH vs SOL 对比结论明确
