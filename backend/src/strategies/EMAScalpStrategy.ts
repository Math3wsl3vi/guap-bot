import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import { BaseStrategy, Signal } from './BaseStrategy';

const COMPONENT = 'EMAScalpStrategy';

interface BlockedRange {
  startMins: number; // inclusive
  endMins: number;   // exclusive
}

function parseBlockedHours(ranges: string[]): BlockedRange[] {
  return ranges
    .map((r) => r.trim())
    .filter((r) => r.includes('-'))
    .map((r) => {
      const [start, end] = r.split('-');
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return { startMins: sh * 60 + (sm || 0), endMins: eh * 60 + (em || 0) };
    });
}

export class EMAScalpStrategy extends BaseStrategy {
  readonly name = 'EMAScalp';

  private readonly fastPeriod: number;
  private readonly slowPeriod: number;
  private readonly trendPeriod: number;
  private readonly rsiPeriod: number;
  private readonly rsiOversold: number;
  private readonly rsiOverbought: number;
  private readonly adxPeriod: number;
  private readonly adxThreshold: number;
  private readonly useAtrStops: boolean;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly atrTpMultiplier: number;
  private readonly minBodyPips: number;
  /** Monetary value of 1 pip (XAU/USD = $0.01 per unit). Used for body-size filter. */
  private readonly pipSize: number;
  private readonly sessionFilterEnabled: boolean;
  private readonly blockedRanges: BlockedRange[];

  /**
   * Minimum candles required before any indicator is valid at both `last` and `prev`:
   *  - EMA(slow) crossover needs prev valid  → slowPeriod + 1
   *  - EMA(trend) needs last valid           → trendPeriod
   *  - RSI needs last valid                  → rsiPeriod + 1
   *  - ADX first valid at index 2×period     → adxPeriod × 2 + 1
   *  - ATR first valid at index period - 1   → atrPeriod
   */
  private readonly minCandles: number;

  constructor() {
    super();
    this.fastPeriod = strategyConfig.emaFastPeriod;
    this.slowPeriod = strategyConfig.emaSlowPeriod;
    this.trendPeriod = strategyConfig.emaTrendPeriod;
    this.rsiPeriod = strategyConfig.rsiPeriod;
    this.rsiOversold = strategyConfig.rsiOversold;
    this.rsiOverbought = strategyConfig.rsiOverbought;
    this.adxPeriod = strategyConfig.adxPeriod;
    this.adxThreshold = strategyConfig.adxThreshold;
    this.useAtrStops = strategyConfig.useAtrStops;
    this.atrPeriod = strategyConfig.atrPeriod;
    this.atrSlMultiplier = strategyConfig.atrSlMultiplier;
    this.atrTpMultiplier = strategyConfig.atrTpMultiplier;
    this.minBodyPips = strategyConfig.minBodyPips;
    this.pipSize = parseFloat(process.env.PIP_SIZE ?? '0.01');
    this.sessionFilterEnabled = strategyConfig.sessionFilterEnabled;
    this.blockedRanges = parseBlockedHours(strategyConfig.blockedHoursUtc);

    this.minCandles = Math.max(
      this.slowPeriod + 1,       // EMA crossover needs prev bar valid
      this.trendPeriod,          // EMA trend needs last bar valid
      this.rsiPeriod + 1,        // RSI first valid at index rsiPeriod
      this.adxPeriod * 2 + 1,   // ADX first valid at index 2×period
      this.atrPeriod,            // ATR first valid at index period - 1
    );
  }

  evaluate(candles: readonly Candle[]): Signal {
    // ── Guard: not enough candles ──────────────────────────────────────────
    if (candles.length < this.minCandles) {
      const s: Signal = {
        action: 'HOLD',
        reason: `Insufficient candles: need ${this.minCandles}, have ${candles.length}`,
      };
      logger.debug(s.reason, { component: COMPONENT });
      return s;
    }

    const last = candles.length - 1;
    const lastCandle = candles[last];

    // ── Filter 1: Session (blocked hours) ─────────────────────────────────
    if (this.sessionFilterEnabled && this.isBlockedHour(lastCandle.timestamp)) {
      return { action: 'HOLD', reason: 'Outside allowed trading hours (session filter)' };
    }

    // ── Filter 2: Minimum candle body size ────────────────────────────────
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const minBodySize = this.minBodyPips * this.pipSize;
    if (bodySize < minBodySize) {
      return {
        action: 'HOLD',
        reason: `Doji/small body (${bodySize.toFixed(4)} < min ${minBodySize.toFixed(4)})`,
      };
    }

    // ── Calculate all indicators ──────────────────────────────────────────
    const closes = candles.map((c) => c.close);

    const emaFast  = TechnicalIndicators.calculateEMA(closes, this.fastPeriod);
    const emaSlow  = TechnicalIndicators.calculateEMA(closes, this.slowPeriod);
    const emaTrend = TechnicalIndicators.calculateEMA(closes, this.trendPeriod);
    const rsi      = TechnicalIndicators.calculateRSI(closes, this.rsiPeriod);
    const { adx: adxArr } = TechnicalIndicators.calculateADX(candles, this.adxPeriod);
    const atrArr   = TechnicalIndicators.calculateATR(candles, this.atrPeriod);

    const prev = last - 1;
    const emaFastCurr  = emaFast[last];
    const emaFastPrev  = emaFast[prev];
    const emaSlowCurr  = emaSlow[last];
    const emaSlowPrev  = emaSlow[prev];
    const emaTrendCurr = emaTrend[last];
    const rsiCurr      = rsi[last];
    const adxCurr      = adxArr[last];
    const atrCurr      = atrArr[last];

    // Guard: all indicators must be warmed up
    if (
      isNaN(emaFastCurr) || isNaN(emaFastPrev) ||
      isNaN(emaSlowCurr) || isNaN(emaSlowPrev) ||
      isNaN(emaTrendCurr) || isNaN(rsiCurr) ||
      isNaN(adxCurr) || isNaN(atrCurr)
    ) {
      return { action: 'HOLD', reason: 'Indicators warming up (NaN values present)' };
    }

    // ── Filter 3: EMA crossover detection ────────────────────────────────
    const crossedAbove = emaFastPrev <= emaSlowPrev && emaFastCurr > emaSlowCurr;
    const crossedBelow = emaFastPrev >= emaSlowPrev && emaFastCurr < emaSlowCurr;

    if (!crossedAbove && !crossedBelow) {
      return {
        action: 'HOLD',
        reason: `No EMA crossover (fast=${emaFastCurr.toFixed(3)}, slow=${emaSlowCurr.toFixed(3)}); RSI ${rsiCurr.toFixed(1)}`,
      };
    }

    const direction: 'BUY' | 'SELL' = crossedAbove ? 'BUY' : 'SELL';

    // ── Filter 4: RSI neutral zone ────────────────────────────────────────
    const rsiNeutral = rsiCurr > this.rsiOversold && rsiCurr < this.rsiOverbought;
    if (!rsiNeutral) {
      const zone = rsiCurr >= this.rsiOverbought ? 'overbought' : 'oversold';
      return {
        action: 'HOLD',
        reason: `${direction === 'BUY' ? 'Bullish' : 'Bearish'} EMA cross but RSI ${rsiCurr.toFixed(1)} is ${zone} — skipping`,
      };
    }

    // ── Filter 5: EMA(trend) direction ───────────────────────────────────
    // BUY only when price is above the trend EMA; SELL only when below it.
    const priceAboveTrend = lastCandle.close > emaTrendCurr;
    if (crossedAbove && !priceAboveTrend) {
      return {
        action: 'HOLD',
        reason: `BUY signal but price below EMA(${this.trendPeriod}) trend line — counter-trend, skip`,
      };
    }
    if (crossedBelow && priceAboveTrend) {
      return {
        action: 'HOLD',
        reason: `SELL signal but price above EMA(${this.trendPeriod}) trend line — counter-trend, skip`,
      };
    }

    // ── Filter 6: ADX trend strength ─────────────────────────────────────
    if (adxCurr < this.adxThreshold) {
      return {
        action: 'HOLD',
        reason: `ADX ${adxCurr.toFixed(1)} < ${this.adxThreshold} — ranging market, skip`,
      };
    }

    // ── Compute ATR-based SL/TP ───────────────────────────────────────────
    let stopLossPips: number | undefined;
    let takeProfitPips: number | undefined;

    if (this.useAtrStops) {
      const atrInPips = atrCurr / this.pipSize;
      stopLossPips   = this.atrSlMultiplier * atrInPips;
      takeProfitPips = this.atrTpMultiplier * atrInPips;
    }

    // ── Build and return signal ───────────────────────────────────────────
    const atrSuffix = stopLossPips !== undefined
      ? `; ATR-SL ${stopLossPips.toFixed(0)}pip TP ${takeProfitPips!.toFixed(0)}pip`
      : '';

    const signal: Signal = {
      action: direction,
      reason: `EMA(${this.fastPeriod}) ${crossedAbove ? 'above' : 'below'} EMA(${this.slowPeriod}); RSI ${rsiCurr.toFixed(1)}; ADX ${adxCurr.toFixed(1)}${atrSuffix}`,
      stopLossPips,
      takeProfitPips,
    };

    logger.info(`Signal: ${direction} — ${signal.reason}`, {
      component: COMPONENT,
      emaFast:  emaFastCurr.toFixed(4),
      emaSlow:  emaSlowCurr.toFixed(4),
      emaTrend: emaTrendCurr.toFixed(4),
      rsi:      rsiCurr.toFixed(2),
      adx:      adxCurr.toFixed(2),
      atr:      atrCurr.toFixed(4),
    });

    return signal;
  }

  /** Returns true when the given UTC timestamp falls within a blocked hour range. */
  private isBlockedHour(timestamp: Date): boolean {
    const totalMins = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
    for (const { startMins, endMins } of this.blockedRanges) {
      if (startMins <= endMins) {
        // Normal range, e.g. 16:00-17:00
        if (totalMins >= startMins && totalMins < endMins) return true;
      } else {
        // Midnight-crossing range, e.g. 22:00-01:00
        if (totalMins >= startMins || totalMins < endMins) return true;
      }
    }
    return false;
  }
}
