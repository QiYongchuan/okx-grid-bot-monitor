/**
 * monitor.js - OKX bot grid monitor + auto-trade executor  [DEMO VERSION]
 *
 * Usage:
 *   node scripts/monitor.js              # demo mode (default)
 *   node scripts/monitor.js --live       # live mode (monitor only, no auto-trade)
 *   node scripts/monitor.js --dry-run    # demo mode + simulate trades without executing
 *
 * Runs one full query cycle, writes logs, prints summary.
 * Triggered by Windows Task Scheduler every 5 minutes.
 *
 * v3: Added auto-trade logic (stop old bot → create new bot on trigger).
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const PROFILE     = process.argv.includes('--live') ? 'live' : 'demo';
const DRY_RUN     = process.argv.includes('--dry-run');
const COINS       = ['ETH-USDT-SWAP'];
const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const CONFIG_FILE = path.join(RUNTIME_DIR, 'auto-trade-config.json');
const STATE_FILE  = path.join(RUNTIME_DIR, 'auto-trade-state.json');

// ── Auto-Trade Config ───────────────────────────────────────────────────────
// Default config - can be overridden via auto-trade-config.json
const DEFAULT_CONFIG = {
  enabled: true,
  // Target: only auto-trade for this specific instId
  targetInstId: 'ETH-USDT-SWAP',
  // Which running bot to manage: 'first' (oldest), 'last' (newest), or specific algoId
  targetBot: 'first',
  // Trigger conditions (checked against current price vs bot's grid range)
  triggers: {
    // Price above bot's maxPx by this much → rebuild upward
    aboveBy: 50,
    // Price below bot's minPx by this much → rebuild downward
    belowBy: 50,
    // Price within range but no live orders for N consecutive checks → sideways stall
    noLiveOrdersChecks: 6,  // 6 checks × 5min = 30min of no activity
  },
  // New bot params
  newBot: {
    gridNum: 12,
    lever: 2,
    sz: 200,
    direction: 'long',
    // Range offset: new range centered on current price
    rangeHalfWidth: 100,  // ±100 USDT from current price
  },
  // Safety
  cooldownMs: 60 * 60 * 1000,   // 1 hour cooldown after a trade
  maxDailyTrades: 2,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

function loadTradeState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return { lastTradeTs: 0, tradesToday: 0, todayDate: '', noLiveOrdersCount: 0, lastTradeLog: [] };
  }
}

function saveTradeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function resetDailyIfNeeded(state) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.todayDate !== today) {
    state.tradesToday = 0;
    state.todayDate = today;
    state.noLiveOrdersCount = 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function okx(args) {
  try {
    return execSync(`okx --profile ${PROFILE} ${args}`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) { return e.stdout || ''; }
}

function okxExec(args) {
  // Throws on failure — use for trade operations
  return execSync(`okx --profile ${PROFILE} ${args}`, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function getField(text, key) {
  const m = text.match(new RegExp(`^${key}\\s+(\\S+)`, 'm'));
  return m ? m[1] : null;
}

function appendNDJSON(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

// Parse "bot grid orders" output to extract running bots
function parseBotOrders(text) {
  const bots = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d{19}\s+/.test(trimmed)) {
      const p = trimmed.split(/\s+/);
      bots.push({
        algoId: p[0],
        instId: p[1],
        type: p[2],
        state: p[3],
        pnl: p[4] || null,
        gridNum: p[5] || null,
        maxPx: p[6] || null,
        minPx: p[7] || null,
      });
    }
  }
  return bots;
}

// Parse "bot grid details" output
function parseBotDetails(text) {
  const details = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(.+)/);
    if (m) details[m[1]] = m[2].trim();
  }
  return details;
}

// Parse "bot grid sub-orders" output
function parseSubOrders(text) {
  const orders = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d{19}\s+/.test(trimmed)) {
      const p = trimmed.split(/\s+/);
      orders.push({
        ordId: p[0],
        side: p[1],
        px: parseFloat(p[2]) || 0,
        sz: parseFloat(p[3]) || 0,
        state: p[4],
        fee: p[5] || null,
      });
    }
  }
  return orders;
}

// ── Init ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });

const ts    = new Date().toISOString();
const state = { ts, profile: PROFILE, coins: {}, alerts: [], botGrid: {}, usdtAvailable: null, autoTrade: null };

// ── Query bot grid status ─────────────────────────────────────────────────────
const botOrdersRaw = okx('bot grid orders --algoOrdType contract_grid');
const bots = parseBotOrders(botOrdersRaw);

// Get all ETH running bots
const ethRunningBots = bots.filter(b => b.state === 'running' && b.instId === 'ETH-USDT-SWAP');
const runningBot = ethRunningBots[0] || null;  // first running ETH bot

state.botGrid.totalBots = bots.length;
state.botGrid.runningBots = ethRunningBots.length;

// Alert: no running bot
if (bots.length > 0 && !runningBot) {
  state.alerts.push({
    type: 'NO_RUNNING_BOT',
    message: `有 ${bots.length} 个 bot 但没有 running 的`,
    bots: bots.map(b => ({ algoId: b.algoId, state: b.state })),
    ts,
  });
} else if (bots.length === 0) {
  state.alerts.push({ type: 'NO_BOT_FOUND', message: '未找到任何 bot grid', ts });
}

// Get details and sub-orders for running bot
if (runningBot) {
  const detailsRaw = okx(`bot grid details --algoOrdType contract_grid --algoId ${runningBot.algoId}`);
  const details = parseBotDetails(detailsRaw);
  state.botGrid.details = details;

  const subOrdersRaw = okx(`bot grid sub-orders --algoOrdType contract_grid --algoId ${runningBot.algoId}`);
  const subOrders = parseSubOrders(subOrdersRaw);

  const liveOrders = subOrders.filter(o => o.state === 'live');
  const filledOrders = subOrders.filter(o => o.state === 'filled');

  state.botGrid.algoId = runningBot.algoId;
  state.botGrid.subOrderCount = subOrders.length;
  state.botGrid.liveOrderCount = liveOrders.length;
  state.botGrid.filledOrderCount = filledOrders.length;
  state.botGrid.subOrders = subOrders.map(o => ({ side: o.side, px: o.px, sz: o.sz, state: o.state }));
  state.botGrid.maxPx = parseFloat(runningBot.maxPx);
  state.botGrid.minPx = parseFloat(runningBot.minPx);
  state.botGrid.gridNum = runningBot.gridNum;

  // Alert: bot running but no live orders
  if (liveOrders.length === 0 && filledOrders.length > 0) {
    state.alerts.push({
      type: 'BOT_NO_LIVE_ORDERS',
      message: `Bot ${runningBot.algoId} 运行中但无活跃挂单，${filledOrders.length} 笔已成交`,
      algoId: runningBot.algoId,
      ts,
    });
  }

  // Alert: bot running with no orders at all (just created?)
  if (subOrders.length === 0) {
    state.alerts.push({
      type: 'BOT_EMPTY',
      message: `Bot ${runningBot.algoId} 运行中但无子订单，可能刚创建`,
      algoId: runningBot.algoId,
      ts,
    });
  }
}

// ── Query each coin ───────────────────────────────────────────────────────────
for (const instId of COINS) {
  const coin   = instId.replace('-USDT-SWAP', '');
  const ticker = okx(`market ticker ${instId}`);
  const posRaw = okx(`swap positions ${instId}`);

  const last   = parseFloat(getField(ticker, 'last') || '0');
  const change = getField(ticker, '24h change %') || '0%';

  // Parse position
  let hasPOS = false;
  let posSize = 0;
  let posUpl = 0;
  const posLines = posRaw.split('\n').slice(2);
  for (const line of posLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('No open') && !trimmed.startsWith('instId')) {
      const p = trimmed.split(/\s+/);
      if (p.length >= 3 && parseFloat(p[2]) !== 0) {
        hasPOS = true;
        posSize = parseFloat(p[2]) || 0;
        posUpl = parseFloat(p[4]) || 0;
      }
    }
  }

  state.coins[coin] = {
    instId, last, change,
    hasPOS, posSize, posUpl,
  };
}

// ── Account balance ───────────────────────────────────────────────────────────
const bal = okx('account balance');
state.usdtAvailable = parseFloat(getField(bal, 'USDT') || '0');

// ── Auto-Trade Logic ──────────────────────────────────────────────────────────
// Only in demo mode, and only if config enables it
if (PROFILE === 'demo' && runningBot) {
  const config = loadConfig();
  const tradeState = loadTradeState();
  resetDailyIfNeeded(tradeState);

  const ethPrice = state.coins['ETH']?.last || 0;
  const botMaxPx = state.botGrid.maxPx || 0;
  const botMinPx = state.botGrid.minPx || 0;
  const liveOrderCount = state.botGrid.liveOrderCount || 0;
  const filledCount = state.botGrid.filledOrderCount || 0;

  let triggerReason = null;
  let newRange = null;

  // Check trigger conditions
  if (config.enabled) {
    // Trigger 1: Price above bot's maxPx + aboveBy
    if (ethPrice > botMaxPx + config.triggers.aboveBy) {
      triggerReason = `ETH ${ethPrice} > bot maxPx ${botMaxPx} + ${config.triggers.aboveBy}`;
      const center = ethPrice;
      newRange = {
        minPx: Math.round(center - config.newBot.rangeHalfWidth),
        maxPx: Math.round(center + config.newBot.rangeHalfWidth),
      };
    }
    // Trigger 2: Price below bot's minPx - belowBy
    else if (ethPrice < botMinPx - config.triggers.belowBy) {
      triggerReason = `ETH ${ethPrice} < bot minPx ${botMinPx} - ${config.triggers.belowBy}`;
      const center = ethPrice;
      newRange = {
        minPx: Math.round(center - config.newBot.rangeHalfWidth),
        maxPx: Math.round(center + config.newBot.rangeHalfWidth),
      };
    }
    // Trigger 3: Sideways stall — bot has no live orders for N consecutive checks
    else if (liveOrderCount === 0 && filledCount > 0) {
      tradeState.noLiveOrdersCount = (tradeState.noLiveOrdersCount || 0) + 1;
      if (tradeState.noLiveOrdersCount >= config.triggers.noLiveOrdersChecks) {
        triggerReason = `No live orders for ${tradeState.noLiveOrdersCount} checks (${tradeState.noLiveOrdersCount * 5}min), price ${ethPrice} within range [${botMinPx}-${botMaxPx}]`;
        newRange = {
          minPx: Math.round(ethPrice - config.newBot.rangeHalfWidth),
          maxPx: Math.round(ethPrice + config.newBot.rangeHalfWidth),
        };
        tradeState.noLiveOrdersCount = 0;
      }
    } else {
      // Reset counter if bot has live orders again
      tradeState.noLiveOrdersCount = 0;
    }
  }

  // Check safety guards
  const now = Date.now();
  const inCooldown = (now - (tradeState.lastTradeTs || 0)) < config.cooldownMs;
  const dailyLimit = tradeState.tradesToday >= config.maxDailyTrades;

  if (triggerReason && !inCooldown && !dailyLimit) {
    // ── Execute auto-trade ────────────────────────────────────────────────────
    const oldAlgoId = runningBot.algoId;
    const oldRange = { minPx: botMinPx, maxPx: botMaxPx, gridNum: state.botGrid.gridNum };
    const logEntry = {
      ts,
      trigger: triggerReason,
      oldBot: { algoId: oldAlgoId, ...oldRange },
      newBot: { ...newRange, gridNum: config.newBot.gridNum },
      dryRun: DRY_RUN,
    };

    console.log(`\n[AUTO-TRADE] Trigger: ${triggerReason}`);
    console.log(`[AUTO-TRADE] Old bot: ${oldAlgoId} [${oldRange.minPx}-${oldRange.maxPx}] ${oldRange.gridNum}grids`);
    console.log(`[AUTO-TRADE] New bot: [${newRange.minPx}-${newRange.maxPx}] ${config.newBot.gridNum}grids`);

    let tradeSuccess = false;
    let errorMsg = null;

    if (!DRY_RUN) {
      try {
        // Step 1: Stop old bot
        console.log(`[AUTO-TRADE] Stopping old bot ${oldAlgoId}...`);
        const stopResult = okxExec(
          `bot grid stop --algoOrdType contract_grid --algoId ${oldAlgoId} --instId ${config.targetInstId}`
        );
        console.log(`[AUTO-TRADE] Stop result: ${stopResult.trim()}`);

        // Step 2: Create new bot
        console.log(`[AUTO-TRADE] Creating new bot [${newRange.minPx}-${newRange.maxPx}]...`);
        const createResult = okxExec(
          `bot grid create --algoOrdType contract_grid --instId ${config.targetInstId} ` +
          `--maxPx ${newRange.maxPx} --minPx ${newRange.minPx} --gridNum ${config.newBot.gridNum} ` +
          `--direction ${config.newBot.direction} --lever ${config.newBot.lever} --sz ${config.newBot.sz}`
        );
        console.log(`[AUTO-TRADE] Create result: ${createResult.trim()}`);

        // Extract new algoId from create result
        const algoIdMatch = createResult.match(/(\d{19})/);
        logEntry.newBot.algoId = algoIdMatch ? algoIdMatch[1] : 'unknown';

        tradeSuccess = true;
      } catch (e) {
        errorMsg = e.message || String(e);
        console.log(`[AUTO-TRADE] ERROR: ${errorMsg}`);
      }
    } else {
      console.log(`[AUTO-TRADE] DRY RUN — no actual trades executed`);
      tradeSuccess = true;
      logEntry.newBot.algoId = 'dry-run-simulated';
    }

    // Update state
    if (tradeSuccess) {
      tradeState.lastTradeTs = now;
      tradeState.tradesToday++;
      logEntry.success = true;
    } else {
      logEntry.success = false;
      logEntry.error = errorMsg;
    }

    tradeState.lastTradeLog = tradeState.lastTradeLog || [];
    tradeState.lastTradeLog.push(logEntry);
    // Keep only last 20 entries
    if (tradeState.lastTradeLog.length > 20) tradeState.lastTradeLog = tradeState.lastTradeLog.slice(-20);

    saveTradeState(tradeState);

    // Alert
    state.alerts.push({
      type: tradeSuccess ? 'AUTO_TRADE_EXECUTED' : 'AUTO_TRADE_FAILED',
      message: tradeSuccess
        ? `Auto-trade: stopped ${oldAlgoId}, created new bot [${newRange.minPx}-${newRange.maxPx}] ${config.newBot.gridNum}grids`
        : `Auto-trade failed: ${errorMsg}`,
      trigger: triggerReason,
      logEntry,
      ts,
    });

    state.autoTrade = logEntry;
  } else {
    // Log why no trade
    const reasons = [];
    if (!config.enabled) reasons.push('disabled');
    if (!triggerReason) reasons.push('no trigger');
    if (inCooldown) reasons.push(`cooldown (${Math.round((config.cooldownMs - (now - (tradeState.lastTradeTs || 0))) / 60000)}min left)`);
    if (dailyLimit) reasons.push(`daily limit (${tradeState.tradesToday}/${config.maxDailyTrades})`);
    state.autoTrade = { status: 'idle', reasons };
  }

  // Always save state (for noLiveOrdersCount tracking etc.)
  saveTradeState(tradeState);
}

// ── Write logs ────────────────────────────────────────────────────────────────
// 1. Latest state (overwrite)
fs.writeFileSync(
  path.join(RUNTIME_DIR, 'latest-state.json'),
  JSON.stringify(state, null, 2), 'utf8'
);

// 2. Monitor log (append)
appendNDJSON(path.join(RUNTIME_DIR, 'monitor-log.ndjson'), state);

// 3. Alert log (append only when alerts exist)
if (state.alerts.length > 0) {
  appendNDJSON(path.join(RUNTIME_DIR, 'alert-log.ndjson'),
    { ts, profile: PROFILE, alerts: state.alerts }
  );
}

// 4. Human-readable notifications.txt (append only when alerts exist)
if (state.alerts.length > 0) {
  const blocks = [];

  for (const a of state.alerts) {
    const timeStr = new Date().toLocaleString('zh-CN', { hour12: false });

    if (a.type === 'AUTO_TRADE_EXECUTED') {
      const entry = a.logEntry;
      blocks.push(
        `[${timeStr}] \ud83d\ude80 AUTO-TRADE EXECUTED\n` +
        `\n` +
        `  \ud83d\udcc9 Trigger: ${a.trigger}\n` +
        `  \u274c Old Bot: ${entry.oldBot.algoId} [${entry.oldBot.minPx}-${entry.oldBot.maxPx}] ${entry.oldBot.gridNum}grids\n` +
        `  \u2705 New Bot: ${entry.newBot.algoId || '?'} [${entry.newBot.minPx}-${entry.newBot.maxPx}] ${entry.newBot.gridNum}grids\n` +
        `\n` +
        `  \ud83d\udcb0 ETH Price: ${state.coins['ETH']?.last}\n` +
        `  \ud83d\udcca Today's Trades: ${(loadTradeState().tradesToday)}`
      );
    } else if (a.type === 'AUTO_TRADE_FAILED') {
      blocks.push(
        `[${timeStr}] \u274c AUTO-TRADE FAILED\n` +
        `\n` +
        `  Trigger: ${a.trigger}\n` +
        `  Error: ${a.logEntry?.error || a.message}\n` +
        `  \u26a0\ufe0f Manual intervention required`
      );
    } else if (a.type === 'NO_RUNNING_BOT') {
      blocks.push(`[${timeStr}] \u26a0\ufe0f Bot \u65e0\u8fd0\u884c\u5b9e\u4f8b | ${a.message}`);
    } else if (a.type === 'NO_BOT_FOUND') {
      blocks.push(`[${timeStr}] \u26a0\ufe0f \u672a\u627e\u5230\u4efb\u4f55 bot grid`);
    } else if (a.type === 'BOT_NO_LIVE_ORDERS') {
      const noLiveCount = loadTradeState().noLiveOrdersCount || 0;
      blocks.push(
        `[${timeStr}] \u26a0\ufe0f Bot \u65e0\u6d3b\u8dc3\u6302\u5355 | ${a.message}\n` +
        `  Sideways stall counter: ${noLiveCount}/${loadConfig().triggers.noLiveOrdersChecks}`
      );
    } else if (a.type === 'BOT_EMPTY') {
      blocks.push(`[${timeStr}] \u2139\ufe0f Bot \u521a\u521b\u5efa | ${a.message}`);
    } else {
      blocks.push(`[${timeStr}] \u2139\ufe0f ${a.type} | ${a.message}`);
    }
  }

  fs.appendFileSync(
    path.join(RUNTIME_DIR, 'notifications.txt'),
    blocks.join('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n') + '\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n',
    'utf8'
  );
}

// ── Print summary (for Cron to read) ─────────────────────────────────────────
const eth = state.coins['ETH'] || {};
const alertStr = state.alerts.length > 0
  ? ` | ALERTS: ${state.alerts.map(a => a.type).join(', ')}`
  : '';

const autoTradeStr = state.autoTrade
  ? (state.autoTrade.status === 'idle'
    ? ` | autoTrade=idle(${state.autoTrade.reasons.join(',')})`
    : ` | autoTrade=${state.autoTrade.success ? 'EXECUTED' : 'FAILED'}`)
  : '';

console.log(
  `[${ts}] ` +
  `ETH=${eth.last}(${eth.change}) pos=${eth.hasPOS ? `${eth.posSize}@${eth.last}` : 'none'} | ` +
  `bot=${state.botGrid.runningBots || 0} running liveOrders=${state.botGrid.liveOrderCount ?? '?'} | ` +
  `USDT=${state.usdtAvailable}` +
  alertStr +
  autoTradeStr
);
