/**
 * Backtesting Runner
 *
 * Simulates the EMAScalpStrategy against historical or synthetic OHLCV data.
 * Supports single-run mode and a grid-search optimiser that ranks parameter
 * combinations by Sharpe ratio.
 *
 * Usage:
 *   # Synthetic data (default 5 000 candles)
 *   npx ts-node tests/backtest/runner.ts
 *
 *   # Custom synthetic candle count
 *   npx ts-node tests/backtest/runner.ts --candles 10000
 *
 *   # Load from CSV  (Date, Open, High, Low, Close, Volume — comma-separated, header row)
 *   npx ts-node tests/backtest/runner.ts --file path/to/data.csv
 *
 *   # Parameter optimisation (grid search, synthetic data)
 *   npx ts-node tests/backtest/runner.ts --optimize
 *
 *   # Parameter optimisation on real CSV data
 *   npx ts-node tests/backtest/runner.ts --optimize --file path/to/data.csv
 *
 *   # Compare baseline vs optimised strategy on the same data
 *   npx ts-node tests/backtest/runner.ts --compare --file path/to/data.csv
 */

// Suppress info/debug logs so strategy signal logs don't drown the report
process.env.LOG_LEVEL = 'warn';

import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../../src/models/Candle';
import { EMAScalpStrategy } from '../../src/strategies/EMAScalpStrategy';
import { strategyConfig } from '../../src/config/strategy.config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacktestConfig {
  takeProfitPips: number; // fallback TP when strategy doesn't supply ATR-based value
  stopLossPips: number;   // fallback SL when strategy doesn't supply ATR-based value
  pipSize: number;        // monetary value of 1 pip per 1 unit (XAU/USD = 0.01)
  riskPercent: number;    // fraction of balance to risk per trade
  initialBalance: number;
}

interface BacktestTrade {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl: number;
  won: boolean;
  openedAt: Date;
  closedAt: Date;
  barsHeld: number;
}

interface OpenPosition {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  openedAt: Date;
  openedAtBar: number;
}

// ─── Synthetic data generator ─────────────────────────────────────────────────

function generateSyntheticCandles(count: number, seed = 42): Candle[] {
  const candles: Candle[] = [];
  let price = 1920;
  const baseTime = new Date('2024-01-01T00:00:00Z').getTime();

  // Deterministic LCG for reproducibility
  let state = seed >>> 0;
  function rng(): number {
    state = Math.imul(state, 1664525) + 1013904223;
    return (state >>> 0) / 0xffffffff;
  }

  for (let i = 0; i < count; i++) {
    // Mild trending behaviour with micro-volatility
    const drift = (rng() - 0.495) * 2.5;
    const range = rng() * 1.5 + 0.5;

    const open  = price;
    const close = Math.max(1800, Math.min(2100, price + drift));
    const high  = Math.max(open, close) + rng() * range;
    const low   = Math.min(open, close) - rng() * range;

    candles.push({
      timestamp: new Date(baseTime + i * 60_000),
      open,
      high,
      low,
      close,
      volume: Math.floor(rng() * 100) + 1,
    });

    price = close;
  }

  return candles;
}

// ─── CSV loader ───────────────────────────────────────────────────────────────

/**
 * Parse a timestamp from common CSV formats:
 *  - Dukascopy:  "01.01.2024 00:00:00.000"  (DD.MM.YYYY HH:mm:ss.mmm)
 *  - ISO/RFC:    "2024-01-01T00:00:00Z"
 *  - Date only:  "2024-01-01"
 *  - Date+Time:  "2024-01-01 00:00:00"
 */
function parseTimestamp(raw: string): Date | null {
  const duka = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (duka) {
    const [, dd, mm, yyyy, hh, min, ss] = duka;
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, +ss));
  }
  const ts = new Date(raw);
  return isNaN(ts.getTime()) ? null : ts;
}

function loadCsv(filePath: string): Candle[] {
  const text   = fs.readFileSync(filePath, 'utf-8');
  const lines  = text.trim().split('\n');
  const candles: Candle[] = [];

  const header = lines[0].toLowerCase().replace(/\s+/g, '');
  const hasSeparateTime =
    header.startsWith('date,time') ||
    (header.startsWith('date,open') === false && /^date,\w+time/.test(header));

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const parts = raw.split(',').map((p) => p.replace(/^"|"$/g, '').trim());

    let dateStr: string;
    let oIdx: number;

    if (hasSeparateTime && parts.length >= 7) {
      dateStr = `${parts[0]} ${parts[1]}`;
      oIdx = 2;
    } else if (parts.length >= 6) {
      dateStr = parts[0];
      oIdx = 1;
    } else {
      continue;
    }

    const ts    = parseTimestamp(dateStr);
    if (!ts) continue;

    const open  = parseFloat(parts[oIdx]);
    const high  = parseFloat(parts[oIdx + 1]);
    const low   = parseFloat(parts[oIdx + 2]);
    const close = parseFloat(parts[oIdx + 3]);
    const vol   = parseFloat(parts[oIdx + 4]) || 0;

    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;

    candles.push({ timestamp: ts, open, high, low, close, volume: Math.round(vol) });
  }

  return candles;
}

// ─── Position sizing ──────────────────────────────────────────────────────────

function calcQuantity(balance: number, slPips: number, cfg: BacktestConfig): number {
  const riskAmount = balance * cfg.riskPercent;
  const raw = riskAmount / (slPips * cfg.pipSize);
  return Math.floor(raw * 100) / 100;
}

// ─── Backtest engine ──────────────────────────────────────────────────────────

function runBacktest(candles: Candle[], cfg: BacktestConfig): BacktestTrade[] {
  const strategy = new EMAScalpStrategy();
  const trades: BacktestTrade[] = [];
  let openPosition: OpenPosition | null = null;
  let balance = cfg.initialBalance;

  for (let i = 1; i < candles.length; i++) {
    const window = candles.slice(0, i);
    const bar    = candles[i];

    // ── Check existing position for SL/TP hit ────────────────────────────
    if (openPosition) {
      let exitPrice: number | null = null;
      let won = false;

      if (openPosition.type === 'BUY') {
        if (bar.low <= openPosition.stopLoss) {
          exitPrice = openPosition.stopLoss;
          won = false;
        } else if (bar.high >= openPosition.takeProfit) {
          exitPrice = openPosition.takeProfit;
          won = true;
        }
      } else {
        if (bar.high >= openPosition.stopLoss) {
          exitPrice = openPosition.stopLoss;
          won = false;
        } else if (bar.low <= openPosition.takeProfit) {
          exitPrice = openPosition.takeProfit;
          won = true;
        }
      }

      if (exitPrice !== null) {
        const pnl =
          openPosition.type === 'BUY'
            ? (exitPrice - openPosition.entryPrice) * openPosition.quantity
            : (openPosition.entryPrice - exitPrice) * openPosition.quantity;

        balance += pnl;

        trades.push({
          type:       openPosition.type,
          entryPrice: openPosition.entryPrice,
          exitPrice,
          stopLoss:   openPosition.stopLoss,
          takeProfit: openPosition.takeProfit,
          quantity:   openPosition.quantity,
          pnl,
          won,
          openedAt:   openPosition.openedAt,
          closedAt:   bar.timestamp,
          barsHeld:   i - openPosition.openedAtBar,
        });

        openPosition = null;
      }
    }

    // ── Evaluate strategy and open new position ───────────────────────────
    if (!openPosition) {
      const signal = strategy.evaluate(window);
      if (signal.action === 'HOLD') continue;

      // Use ATR-based SL/TP from signal when available; fall back to config
      const slPips = signal.stopLossPips ?? cfg.stopLossPips;
      const tpPips = signal.takeProfitPips ?? cfg.takeProfitPips;
      const slDist = slPips * cfg.pipSize;
      const tpDist = tpPips * cfg.pipSize;

      // Enter on the next bar's open price
      const entry = bar.open;
      const qty   = calcQuantity(balance, slPips, cfg);
      if (qty <= 0) continue;

      if (signal.action === 'BUY') {
        openPosition = {
          type:        'BUY',
          entryPrice:  entry,
          stopLoss:    entry - slDist,
          takeProfit:  entry + tpDist,
          quantity:    qty,
          openedAt:    bar.timestamp,
          openedAtBar: i,
        };
      } else {
        openPosition = {
          type:        'SELL',
          entryPrice:  entry,
          stopLoss:    entry + slDist,
          takeProfit:  entry - tpDist,
          quantity:    qty,
          openedAt:    bar.timestamp,
          openedAtBar: i,
        };
      }
    }
  }

  return trades;
}

// ─── Metrics calculation ──────────────────────────────────────────────────────

interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  averageWin: number;
  averageLoss: number;
  maxConsecutiveLosses: number;
  avgBarsHeld: number;
  finalBalance: number;
  returnPct: number;
}

function calcMetrics(trades: BacktestTrade[], initialBalance: number): BacktestMetrics {
  const wins   = trades.filter((t) => t.won);
  const losses = trades.filter((t) => !t.won);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netProfit   = grossProfit - grossLoss;

  // Running balance for drawdown
  let peak = initialBalance;
  let balance = initialBalance;
  let maxDrawdown = 0;
  for (const t of trades) {
    balance += t.pnl;
    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Daily P&L for Sharpe ratio
  const dailyPnl = new Map<string, number>();
  for (const t of trades) {
    const day = t.closedAt.toISOString().slice(0, 10);
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + t.pnl);
  }
  const dailyReturns = Array.from(dailyPnl.values());
  const meanReturn   = dailyReturns.length
    ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length : 0;
  const variance     = dailyReturns.length
    ? dailyReturns.reduce((s, v) => s + (v - meanReturn) ** 2, 0) / dailyReturns.length : 0;
  const sharpeRatio  = variance > 0
    ? (meanReturn / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  // Max consecutive losses
  let maxConsec = 0, consec = 0;
  for (const t of trades) {
    consec = t.won ? 0 : consec + 1;
    if (consec > maxConsec) maxConsec = consec;
  }

  return {
    totalTrades:          trades.length,
    wins:                 wins.length,
    losses:               losses.length,
    winRate:              trades.length ? wins.length / trades.length : 0,
    grossProfit,
    grossLoss,
    netProfit,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdown,
    sharpeRatio,
    averageWin:           wins.length   ? grossProfit / wins.length   : 0,
    averageLoss:          losses.length ? grossLoss   / losses.length : 0,
    maxConsecutiveLosses: maxConsec,
    avgBarsHeld:          trades.length
      ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0,
    finalBalance:         initialBalance + netProfit,
    returnPct:            (netProfit / initialBalance) * 100,
  };
}

// ─── Report printer ───────────────────────────────────────────────────────────

function printReport(
  metrics: BacktestMetrics,
  candles: Candle[],
  cfg: BacktestConfig,
  label = 'BACKTEST REPORT',
): void {
  const pct    = (n: number) => `${(n * 100).toFixed(2)}%`;
  const dollar = (n: number) => `$${n.toFixed(2)}`;
  const fmt    = (n: number, dp = 2) => n.toFixed(dp);

  const period =
    candles.length > 0
      ? `${candles[0].timestamp.toISOString().slice(0, 10)} → ${candles[candles.length - 1].timestamp.toISOString().slice(0, 10)}`
      : 'N/A';

  const border = '═'.repeat(48);
  console.log(`\n╔${border}╗`);
  console.log(`║  ${label.padEnd(46)}║`);
  console.log(`╚${border}╝`);

  console.log(`\nPeriod          : ${period}`);
  console.log(`Total candles   : ${candles.length.toLocaleString()} (1-minute bars)`);
  console.log(
    `Strategy        : EMAScalp — EMA(${strategyConfig.emaFastPeriod}/${strategyConfig.emaSlowPeriod}/${strategyConfig.emaTrendPeriod}), RSI(${strategyConfig.rsiPeriod}), ADX(${strategyConfig.adxPeriod})`,
  );
  console.log(
    `Stops           : ${strategyConfig.useAtrStops ? `ATR(${strategyConfig.atrPeriod}) × ${strategyConfig.atrSlMultiplier}/${strategyConfig.atrTpMultiplier}` : `Fixed ${cfg.stopLossPips}SL / ${cfg.takeProfitPips}TP pips`}`,
  );
  console.log(`Session filter  : ${strategyConfig.sessionFilterEnabled ? `enabled (blocked: ${strategyConfig.blockedHoursUtc.join(', ')})` : 'disabled'}`);
  console.log(`ADX threshold   : ${strategyConfig.adxThreshold}`);
  console.log(`Risk / trade    : ${pct(cfg.riskPercent)}`);
  console.log(`Starting bal.   : ${dollar(cfg.initialBalance)}`);

  console.log('\n── Trade Statistics ────────────────────────────────────');
  console.log(`Total trades    : ${metrics.totalTrades}`);
  console.log(`Wins            : ${metrics.wins} (${pct(metrics.winRate)})`);
  console.log(`Losses          : ${metrics.losses} (${pct(1 - metrics.winRate)})`);
  console.log(`Max consec. L   : ${metrics.maxConsecutiveLosses}`);
  console.log(`Avg bars held   : ${fmt(metrics.avgBarsHeld)}`);

  console.log('\n── P&L ─────────────────────────────────────────────────');
  console.log(`Gross profit    : ${dollar(metrics.grossProfit)}`);
  console.log(`Gross loss      : ${dollar(metrics.grossLoss)}`);
  console.log(`Net profit      : ${dollar(metrics.netProfit)}`);
  console.log(`Return          : ${pct(metrics.returnPct / 100)}`);
  console.log(`Final balance   : ${dollar(metrics.finalBalance)}`);
  console.log(`Avg win         : ${dollar(metrics.averageWin)}`);
  console.log(`Avg loss        : ${dollar(metrics.averageLoss)}`);

  console.log('\n── Risk Metrics ────────────────────────────────────────');
  console.log(`Profit factor   : ${metrics.profitFactor === Infinity ? '∞' : fmt(metrics.profitFactor)}`);
  console.log(`Max drawdown    : ${pct(metrics.maxDrawdown)}`);
  console.log(`Sharpe ratio    : ${fmt(metrics.sharpeRatio)}`);

  console.log('\n── Verdict ─────────────────────────────────────────────');
  const issues: string[] = [];
  if (metrics.winRate < 0.4)       issues.push(`Low win rate (${pct(metrics.winRate)} < 40%)`);
  if (metrics.profitFactor < 1.2)  issues.push(`Low profit factor (${fmt(metrics.profitFactor)} < 1.2)`);
  if (metrics.maxDrawdown > 0.15)  issues.push(`High drawdown (${pct(metrics.maxDrawdown)} > 15%)`);
  if (metrics.sharpeRatio < 0.5)   issues.push(`Low Sharpe ratio (${fmt(metrics.sharpeRatio)} < 0.5)`);

  if (issues.length === 0 && metrics.totalTrades > 0) {
    console.log('✓ Strategy passes basic quality thresholds — consider paper trading.');
  } else if (metrics.totalTrades === 0) {
    console.log('⚠ No trades generated — check data length and strategy parameters.');
  } else {
    console.log('✗ Issues found — optimise before paper trading:');
    issues.forEach((i) => console.log(`  • ${i}`));
  }
  console.log('');
}

// ─── Parameter optimisation ───────────────────────────────────────────────────

interface OptimParams {
  emaFast: number;
  emaSlow: number;
  rsiOversold: number;
  rsiOverbought: number;
  adxThreshold: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
}

interface OptimResult extends OptimParams {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  netProfit: number;
  returnPct: number;
}

function runOptimize(candles: Candle[], cfg: BacktestConfig): void {
  const emaFastRange      = [5, 7, 9, 12];
  const emaSlowRange      = [18, 21, 26];
  const rsiBoundsRange    = [{ lo: 25, hi: 75 }, { lo: 30, hi: 70 }];
  const adxRange          = [20, 25, 30];
  const atrSlRange        = [1.0, 1.5, 2.0];
  const atrTpRange        = [2.0, 3.0, 4.0];

  const results: OptimResult[] = [];
  let tested = 0;
  let total  = 0;

  // Count valid combos first
  for (const ef of emaFastRange)
    for (const es of emaSlowRange)
      if (ef < es)
        total += rsiBoundsRange.length * adxRange.length * atrSlRange.length * atrTpRange.length;

  console.log(`\nRunning parameter sweep (${total} combinations)…`);

  for (const ef of emaFastRange) {
    for (const es of emaSlowRange) {
      if (ef >= es) continue; // fast must be < slow

      for (const rsi of rsiBoundsRange) {
        for (const adxT of adxRange) {
          for (const atrSl of atrSlRange) {
            for (const atrTp of atrTpRange) {
              // Mutate strategyConfig in-place (it's a mutable global)
              strategyConfig.emaFastPeriod  = ef;
              strategyConfig.emaSlowPeriod  = es;
              strategyConfig.rsiOversold    = rsi.lo;
              strategyConfig.rsiOverbought  = rsi.hi;
              strategyConfig.adxThreshold   = adxT;
              strategyConfig.atrSlMultiplier = atrSl;
              strategyConfig.atrTpMultiplier = atrTp;
              strategyConfig.useAtrStops    = true;
              strategyConfig.sessionFilterEnabled = true;

              const trades  = runBacktest(candles, cfg);
              const metrics = calcMetrics(trades, cfg.initialBalance);

              results.push({
                emaFast:        ef,
                emaSlow:        es,
                rsiOversold:    rsi.lo,
                rsiOverbought:  rsi.hi,
                adxThreshold:   adxT,
                atrSlMultiplier: atrSl,
                atrTpMultiplier: atrTp,
                totalTrades:    metrics.totalTrades,
                winRate:        metrics.winRate,
                profitFactor:   metrics.profitFactor,
                maxDrawdown:    metrics.maxDrawdown,
                sharpeRatio:    metrics.sharpeRatio,
                netProfit:      metrics.netProfit,
                returnPct:      metrics.returnPct,
              });

              tested++;
              if (tested % 50 === 0) process.stdout.write(`  ${tested}/${total}\r`);
            }
          }
        }
      }
    }
  }

  console.log(`  ${tested}/${total} done.\n`);

  // Rank by Sharpe ratio; filter to at least 10 trades
  const valid = results
    .filter((r) => r.totalTrades >= 10)
    .sort((a, b) => b.sharpeRatio - a.sharpeRatio);

  const top = valid.slice(0, 10);

  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  TOP 10 PARAMETER COMBINATIONS (ranked by Sharpe ratio)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(
    `\n${'Rank'.padEnd(5)} ${'EMAf'.padEnd(5)} ${'EMAs'.padEnd(5)} ${'RSI'.padEnd(8)} ${'ADX'.padEnd(5)} ${'SL×'.padEnd(5)} ${'TP×'.padEnd(5)} ${'Trades'.padEnd(7)} ${'WR%'.padEnd(7)} ${'PF'.padEnd(6)} ${'MDD%'.padEnd(7)} ${'Sharpe'.padEnd(7)} ${'Net$'}`,
  );
  console.log('─'.repeat(94));

  top.forEach((r, idx) => {
    const pct = (n: number) => (n * 100).toFixed(1);
    console.log(
      `${String(idx + 1).padEnd(5)} ` +
      `${r.emaFast.toString().padEnd(5)} ` +
      `${r.emaSlow.toString().padEnd(5)} ` +
      `${`${r.rsiOversold}/${r.rsiOverbought}`.padEnd(8)} ` +
      `${r.adxThreshold.toString().padEnd(5)} ` +
      `${r.atrSlMultiplier.toFixed(1).padEnd(5)} ` +
      `${r.atrTpMultiplier.toFixed(1).padEnd(5)} ` +
      `${r.totalTrades.toString().padEnd(7)} ` +
      `${pct(r.winRate).padEnd(7)} ` +
      `${(r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)).padEnd(6)} ` +
      `${pct(r.maxDrawdown).padEnd(7)} ` +
      `${r.sharpeRatio.toFixed(2).padEnd(7)} ` +
      `$${r.netProfit.toFixed(0)}`,
    );
  });

  if (valid.length === 0) {
    console.log('⚠ No combinations produced ≥10 trades — try more candles or wider parameters.');
  } else {
    const best = top[0];
    console.log('\n── Best combination ────────────────────────────────────────────────────────');
    console.log(`  EMA fast/slow   : ${best.emaFast} / ${best.emaSlow}`);
    console.log(`  RSI bounds      : ${best.rsiOversold} / ${best.rsiOverbought}`);
    console.log(`  ADX threshold   : ${best.adxThreshold}`);
    console.log(`  ATR SL/TP mult  : ${best.atrSlMultiplier} / ${best.atrTpMultiplier}`);
    console.log('\nTo apply these settings, set the following env vars (or update .env):');
    console.log(`  EMA_FAST_PERIOD=${best.emaFast}`);
    console.log(`  EMA_SLOW_PERIOD=${best.emaSlow}`);
    console.log(`  RSI_OVERSOLD=${best.rsiOversold}`);
    console.log(`  RSI_OVERBOUGHT=${best.rsiOverbought}`);
    console.log(`  ADX_THRESHOLD=${best.adxThreshold}`);
    console.log(`  ATR_SL_MULTIPLIER=${best.atrSlMultiplier}`);
    console.log(`  ATR_TP_MULTIPLIER=${best.atrTpMultiplier}`);
  }
  console.log('');
}

// ─── Comparison mode (baseline vs new) ───────────────────────────────────────

/**
 * Runs the original, unfiltered EMA(9/21) + RSI(14) strategy directly via indicators
 * — no ADX, no trend EMA, no session filter, fixed SL/TP.  Used for baseline comparison.
 */
function runBaselineBacktest(candles: Candle[], cfg: BacktestConfig): BacktestTrade[] {
  const { TechnicalIndicators } = require('../../src/indicators/TechnicalIndicators');
  const FAST = 9, SLOW = 21, RSI_P = 14, RSI_LO = 30, RSI_HI = 70;
  const MIN = SLOW + 1; // minimum candles for crossover check

  const trades: BacktestTrade[] = [];
  let openPosition: OpenPosition | null = null;
  let balance = cfg.initialBalance;

  const slDist = cfg.stopLossPips * cfg.pipSize;
  const tpDist = cfg.takeProfitPips * cfg.pipSize;

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i];

    // Check SL/TP on open position
    if (openPosition) {
      let exitPrice: number | null = null;
      let won = false;
      if (openPosition.type === 'BUY') {
        if (bar.low  <= openPosition.stopLoss)  { exitPrice = openPosition.stopLoss;  won = false; }
        else if (bar.high >= openPosition.takeProfit) { exitPrice = openPosition.takeProfit; won = true; }
      } else {
        if (bar.high >= openPosition.stopLoss)  { exitPrice = openPosition.stopLoss;  won = false; }
        else if (bar.low  <= openPosition.takeProfit) { exitPrice = openPosition.takeProfit; won = true; }
      }
      if (exitPrice !== null) {
        const pnl = openPosition.type === 'BUY'
          ? (exitPrice - openPosition.entryPrice) * openPosition.quantity
          : (openPosition.entryPrice - exitPrice) * openPosition.quantity;
        balance += pnl;
        trades.push({
          type: openPosition.type, entryPrice: openPosition.entryPrice, exitPrice,
          stopLoss: openPosition.stopLoss, takeProfit: openPosition.takeProfit,
          quantity: openPosition.quantity, pnl, won,
          openedAt: openPosition.openedAt, closedAt: bar.timestamp,
          barsHeld: i - openPosition.openedAtBar,
        });
        openPosition = null;
      }
    }

    if (!openPosition && i >= MIN) {
      const win = candles.slice(0, i);
      const closes = win.map((c) => c.close);
      const emaFast = TechnicalIndicators.calculateEMA(closes, FAST);
      const emaSlow = TechnicalIndicators.calculateEMA(closes, SLOW);
      const rsi     = TechnicalIndicators.calculateRSI(closes, RSI_P);
      const last = closes.length - 1, prev = last - 1;
      const [ef, ep, es, esi, rc] = [emaFast[last], emaFast[prev], emaSlow[last], emaSlow[prev], rsi[last]];
      if (isNaN(ef) || isNaN(ep) || isNaN(es) || isNaN(esi) || isNaN(rc)) continue;
      const rsiOk = rc > RSI_LO && rc < RSI_HI;
      const crossAbove = ep <= esi && ef > es;
      const crossBelow = ep >= esi && ef < es;

      if ((crossAbove || crossBelow) && rsiOk) {
        const entry = bar.open;
        const type: 'BUY' | 'SELL' = crossAbove ? 'BUY' : 'SELL';
        const qty = calcQuantity(balance, cfg.stopLossPips, cfg);
        if (qty > 0) {
          openPosition = {
            type, entryPrice: entry,
            stopLoss:   type === 'BUY' ? entry - slDist : entry + slDist,
            takeProfit: type === 'BUY' ? entry + tpDist : entry - tpDist,
            quantity: qty, openedAt: bar.timestamp, openedAtBar: i,
          };
        }
      }
    }
  }
  return trades;
}

function runCompare(candles: Candle[], cfg: BacktestConfig): void {
  // ── Baseline: pure EMA(9/21) crossover + RSI, fixed 5SL/8TP pips ─────────
  const baseTrades  = runBaselineBacktest(candles, cfg);
  const baseMetrics = calcMetrics(baseTrades, cfg.initialBalance);

  // Temporarily patch config for the report header
  const savedFast = strategyConfig.emaFastPeriod;
  const savedSlow = strategyConfig.emaSlowPeriod;
  const savedTrend = strategyConfig.emaTrendPeriod;
  const savedAdx  = strategyConfig.adxThreshold;
  const savedAtr  = strategyConfig.useAtrStops;
  const savedSess = strategyConfig.sessionFilterEnabled;

  strategyConfig.emaFastPeriod  = 9;
  strategyConfig.emaSlowPeriod  = 21;
  strategyConfig.emaTrendPeriod = 0;      // show as "disabled" in header
  strategyConfig.adxThreshold   = 0;
  strategyConfig.useAtrStops    = false;
  strategyConfig.sessionFilterEnabled = false;
  printReport(baseMetrics, candles, cfg, 'BASELINE  (EMA9/21 + RSI14, fixed stops)');

  // ── Optimised: all new filters enabled ───────────────────────────────────
  strategyConfig.emaFastPeriod   = savedFast;
  strategyConfig.emaSlowPeriod   = savedSlow;
  strategyConfig.emaTrendPeriod  = 50;
  strategyConfig.adxThreshold    = 25;
  strategyConfig.useAtrStops     = true;
  strategyConfig.atrSlMultiplier = 1.5;
  strategyConfig.atrTpMultiplier = 3.0;
  strategyConfig.sessionFilterEnabled = true;

  const newTrades  = runBacktest(candles, cfg);
  const newMetrics = calcMetrics(newTrades, cfg.initialBalance);
  printReport(newMetrics, candles, cfg, 'OPTIMISED (ATR stops + EMA50 + ADX + session)');

  // Restore
  strategyConfig.emaTrendPeriod = savedTrend;
  strategyConfig.adxThreshold   = savedAdx;
  strategyConfig.useAtrStops    = savedAtr;
  strategyConfig.sessionFilterEnabled = savedSess;

  // ── Side-by-side delta ────────────────────────────────────────────────────
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const delta = (n: number, prev: number) => {
    const d = n - prev;
    return (d >= 0 ? '+' : '') + (Number.isFinite(d) ? d.toFixed(2) : '∞');
  };

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║         PERFORMANCE DELTA (new – old)        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Trades     : ${baseMetrics.totalTrades} → ${newMetrics.totalTrades} (${delta(newMetrics.totalTrades, baseMetrics.totalTrades)})`);
  console.log(`  Win rate   : ${pct(baseMetrics.winRate)} → ${pct(newMetrics.winRate)} (${delta(newMetrics.winRate * 100, baseMetrics.winRate * 100)}pp)`);
  console.log(`  Profit fac.: ${baseMetrics.profitFactor.toFixed(2)} → ${newMetrics.profitFactor === Infinity ? '∞' : newMetrics.profitFactor.toFixed(2)}`);
  console.log(`  Max DD     : ${pct(baseMetrics.maxDrawdown)} → ${pct(newMetrics.maxDrawdown)}`);
  console.log(`  Sharpe     : ${baseMetrics.sharpeRatio.toFixed(2)} → ${newMetrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Net profit : $${baseMetrics.netProfit.toFixed(2)} → $${newMetrics.netProfit.toFixed(2)}\n`);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

function main(): void {
  const args      = process.argv.slice(2);
  const fileIdx   = args.indexOf('--file');
  const candleIdx = args.indexOf('--candles');
  const doOptimize = args.includes('--optimize');
  const doCompare  = args.includes('--compare');

  const cfg: BacktestConfig = {
    takeProfitPips: strategyConfig.takeProfitPips,
    stopLossPips:   strategyConfig.stopLossPips,
    pipSize:        0.01,    // XAU/USD: 1 pip = $0.01 per unit
    riskPercent:    0.01,    // 1% of balance per trade
    initialBalance: 10_000,
  };

  let candles: Candle[];

  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const filePath = path.resolve(args[fileIdx + 1]);
    console.log(`Loading candles from ${filePath}…`);
    candles = loadCsv(filePath);
    console.log(`Loaded ${candles.length.toLocaleString()} candles.`);
  } else {
    const count = candleIdx !== -1 ? parseInt(args[candleIdx + 1], 10) : 5_000;
    console.log(`Generating ${count.toLocaleString()} synthetic 1-minute candles…`);
    candles = generateSyntheticCandles(count);
  }

  if (candles.length < 100) {
    console.error('Need at least 100 candles for meaningful results.');
    process.exit(1);
  }

  if (doOptimize) {
    runOptimize(candles, cfg);
  } else if (doCompare) {
    runCompare(candles, cfg);
  } else {
    console.log('Running backtest…');
    const trades  = runBacktest(candles, cfg);
    const metrics = calcMetrics(trades, cfg.initialBalance);
    printReport(metrics, candles, cfg);
  }
}

main();
