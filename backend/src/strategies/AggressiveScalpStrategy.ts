import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import { BaseStrategy, HTFCandleMap, Signal } from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'AggressiveScalpStrategy';

export class AggressiveScalpStrategy extends BaseStrategy {
  readonly name = 'Aggressive Scalping';
  readonly type: StrategyType = 'AGGRESSIVE_SCALPING';

  private readonly fastPeriod: number;
  private readonly slowPeriod: number;
  private readonly rsiPeriod: number;
  private readonly rsiOversold: number;
  private readonly rsiOverbought: number;
  private readonly adxPeriod: number;
  private readonly adxThreshold: number;
  private readonly useTrendFilter: boolean;
  private readonly trendPeriod: number;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly atrTpMultiplier: number;
  private readonly breakevenAfterPips: number;
  private readonly trailingActivationPips: number;
  private readonly pipSize: number;
  private readonly minCandles: number;

  constructor() {
    super();
    const agg = strategyConfig.aggressive;
    this.fastPeriod = agg.emaFast;
    this.slowPeriod = agg.emaSlow;
    this.rsiPeriod = strategyConfig.rsiPeriod;
    this.rsiOversold = agg.rsiOversold;
    this.rsiOverbought = agg.rsiOverbought;
    this.adxPeriod = strategyConfig.adxPeriod;
    this.adxThreshold = agg.adxThreshold;
    this.useTrendFilter = agg.useTrendFilter;
    this.trendPeriod = strategyConfig.emaTrendPeriod;
    this.atrPeriod = strategyConfig.atrPeriod;
    this.atrSlMultiplier = strategyConfig.atrSlMultiplier;
    this.atrTpMultiplier = strategyConfig.atrTpMultiplier;
    this.breakevenAfterPips = agg.breakevenAfterPips;
    this.trailingActivationPips = agg.trailingActivationPips;
    this.pipSize = parseFloat(process.env.PIP_SIZE ?? '0.01');

    this.minCandles = Math.max(
      this.slowPeriod + 1,
      this.useTrendFilter ? this.trendPeriod : 0,
      this.rsiPeriod + 1,
      this.adxPeriod * 2 + 1,
      this.atrPeriod,
    );
  }

  evaluate(candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
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
    const closes = candles.map((c) => c.close);

    const emaFast = TechnicalIndicators.calculateEMA(closes, this.fastPeriod);
    const emaSlow = TechnicalIndicators.calculateEMA(closes, this.slowPeriod);
    const rsi = TechnicalIndicators.calculateRSI(closes, this.rsiPeriod);
    const { adx: adxArr } = TechnicalIndicators.calculateADX(candles, this.adxPeriod);
    const atrArr = TechnicalIndicators.calculateATR(candles, this.atrPeriod);

    const prev = last - 1;
    const emaFastCurr = emaFast[last];
    const emaFastPrev = emaFast[prev];
    const emaSlowCurr = emaSlow[last];
    const emaSlowPrev = emaSlow[prev];
    const rsiCurr = rsi[last];
    const adxCurr = adxArr[last];
    const atrCurr = atrArr[last];

    if (
      isNaN(emaFastCurr) || isNaN(emaFastPrev) ||
      isNaN(emaSlowCurr) || isNaN(emaSlowPrev) ||
      isNaN(rsiCurr) || isNaN(adxCurr) || isNaN(atrCurr)
    ) {
      return { action: 'HOLD', reason: 'Indicators warming up (NaN values present)' };
    }

    // EMA crossover detection
    const crossedAbove = emaFastPrev <= emaSlowPrev && emaFastCurr > emaSlowCurr;
    const crossedBelow = emaFastPrev >= emaSlowPrev && emaFastCurr < emaSlowCurr;

    if (!crossedAbove && !crossedBelow) {
      return {
        action: 'HOLD',
        reason: `No EMA crossover (fast=${emaFastCurr.toFixed(3)}, slow=${emaSlowCurr.toFixed(3)})`,
      };
    }

    const direction: 'BUY' | 'SELL' = crossedAbove ? 'BUY' : 'SELL';

    // Relaxed RSI filter (20-80)
    const rsiNeutral = rsiCurr > this.rsiOversold && rsiCurr < this.rsiOverbought;
    if (!rsiNeutral) {
      const zone = rsiCurr >= this.rsiOverbought ? 'overbought' : 'oversold';
      return {
        action: 'HOLD',
        reason: `${direction} EMA cross but RSI ${rsiCurr.toFixed(1)} is ${zone} — skipping`,
      };
    }

    // Optional trend filter
    if (this.useTrendFilter) {
      const emaTrend = TechnicalIndicators.calculateEMA(closes, this.trendPeriod);
      const emaTrendCurr = emaTrend[last];
      if (!isNaN(emaTrendCurr)) {
        const priceAboveTrend = lastCandle.close > emaTrendCurr;
        if (crossedAbove && !priceAboveTrend) {
          return { action: 'HOLD', reason: `BUY signal but price below EMA(${this.trendPeriod}) trend — counter-trend, skip` };
        }
        if (crossedBelow && priceAboveTrend) {
          return { action: 'HOLD', reason: `SELL signal but price above EMA(${this.trendPeriod}) trend — counter-trend, skip` };
        }
      }
    }

    // ADX filter (lower threshold)
    if (adxCurr < this.adxThreshold) {
      return {
        action: 'HOLD',
        reason: `ADX ${adxCurr.toFixed(1)} < ${this.adxThreshold} — weak trend, skip`,
      };
    }

    // ATR-based SL/TP (always on for aggressive)
    const atrInPips = atrCurr / this.pipSize;
    const stopLossPips = this.atrSlMultiplier * atrInPips;
    const takeProfitPips = this.atrTpMultiplier * atrInPips;

    const signal: Signal = {
      action: direction,
      reason: `EMA(${this.fastPeriod}) ${crossedAbove ? 'above' : 'below'} EMA(${this.slowPeriod}); RSI ${rsiCurr.toFixed(1)}; ADX ${adxCurr.toFixed(1)}; ATR-SL ${stopLossPips.toFixed(0)}pip TP ${takeProfitPips.toFixed(0)}pip`,
      stopLossPips,
      takeProfitPips,
      strategyType: this.type,
      breakevenMove: true,
      trailingActivationPips: this.trailingActivationPips,
    };

    logger.info(`Signal: ${direction} — ${signal.reason}`, {
      component: COMPONENT,
      emaFast: emaFastCurr.toFixed(4),
      emaSlow: emaSlowCurr.toFixed(4),
      rsi: rsiCurr.toFixed(2),
      adx: adxCurr.toFixed(2),
      atr: atrCurr.toFixed(4),
    });

    return signal;
  }
}
