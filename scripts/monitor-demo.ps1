# monitor-demo.ps1
# 模拟盘监控脚本 - ETH + SOL 双币网格
# 运行方式: .\scripts\monitor-demo.ps1
# 停止方式: Ctrl+C

$INTERVAL_SEC = 300        # 5 分钟
$LOG_DIR      = "$PSScriptRoot\..\runtime"
$LOG_FILE     = "$LOG_DIR\monitor-demo.log"
$COINS        = @("ETH-USDT-SWAP", "SOL-USDT-SWAP")

# 确保 runtime 目录存在
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-OkxField($output, $field) {
    $line = $output | Where-Object { $_ -match "^$field\s" }
    if ($line) { ($line -split '\s+')[1] } else { "N/A" }
}

Write-Log "====== 监控启动 | 间隔 ${INTERVAL_SEC}s | 币种: $($COINS -join ', ') ======"

$round = 0
while ($true) {
    $round++
    Write-Log "--- Round $round ---"

    foreach ($instId in $COINS) {
        $coin = $instId -replace "-USDT-SWAP",""

        # 当前价格
        $ticker = okx --profile demo market ticker $instId 2>&1
        $last   = Get-OkxField $ticker "last"
        $chg    = Get-OkxField $ticker "24h change %"

        # 挂单
        $orders = okx --profile demo swap orders --instId $instId 2>&1
        $orderLines = $orders | Where-Object { $_ -match "^\d{19}" }
        $orderCount = $orderLines.Count

        # 持仓
        $pos = okx --profile demo swap positions $instId 2>&1
        $hasPos = if ($pos -match "No open positions" -or $pos -match "^\s*$" -or ($pos | Where-Object { $_ -match "^\d" }).Count -eq 0) { "无持仓" } else {
            $posLine = $pos | Where-Object { $_ -match "^\S" } | Select-Object -Skip 1 -First 1
            "有持仓: $posLine"
        }

        Write-Log "$coin | 价格=$last ($chg) | 挂单=$orderCount 笔 | $hasPos"

        # 如果有持仓，打印详情
        if ($hasPos -ne "无持仓") {
            $fills = okx --profile demo swap fills --instId $instId 2>&1
            $fillLines = $fills | Where-Object { $_ -match "^\d{19}" }
            Write-Log "$coin | 最近成交: $($fillLines.Count) 笔"
        }
    }

    # 账户余额快照
    $bal = okx --profile demo account balance 2>&1
    $usdt = Get-OkxField $bal "USDT"
    Write-Log "账户 USDT 可用: $usdt"

    Write-Log "--- 等待 ${INTERVAL_SEC}s ---"
    Write-Host ""
    Start-Sleep -Seconds $INTERVAL_SEC
}
