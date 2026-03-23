import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import { BaseStrategy, Signal } from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'MeanReversionStrategy';

export class MeanReversionStrategy extends BaseStrategy {
  readonly name = 'Mean Reversion';
  readonly type: StrategyType = 'MEAN_REVERSION';

  private readonly bollingerPeriod: number;
  private readonly bollingerStdDev: number;
  private readonly rsiPeriod: number;
  private readonly rsiOversold: number;
  private readonly rsiOverbought: number;
  private readonly adxPeriod: number;
  /** Max ADX value — above this means a trending market (skip). */
  private readonly adxMaxThreshold: number = 30;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly atrTpMultiplier: number;
  private readonly pipSize: number;
  private readonly minCandles: number;

  constructor() {
    super();
    const mr = strategyConfig.meanReversion;
    this.bollingerPeriod = mr.bollingerPeriod;
    this.bollingerStdDev = mr.bollingerStdDev;
    this.rsiPeriod = strategyConfig.rsiPeriod;
    this.rsiOversold = mr.rsiOversold;
    this.rsiOverbought = mr.rsiOverbought;
    this.adxPeriod = strategyConfig.adxPeriod;
    this.atrPeriod = strategyConfig.atrPeriod;
    this.atrSlMultiplier = mr.atrSlMultiplier;
    this.atrTpMultiplier = mr.atrTpMultiplier;
    this.pipSize = parseFloat(process.env.PIP_SIZE ?? '0.01');

    this.minCandles = Math.max(
      this.bollingerPeriod,
      this.rsiPeriod + 1,
      this.adxPeriod * 2 + 1,
      this.atrPeriod,
    );
  }

  evaluate(candles: readonly Candle[]): Signal {
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

    const bb = TechnicalIndicators.calculateBollingerBands(closes, this.bollingerPeriod, this.bollingerStdDev);
    const rsi = TechnicalIndicators.calculateRSI(closes, this.rsiPeriod);
    const { adx: adxArr } = TechnicalIndicators.calculateADX(candles, this.adxPeriod);
    const atrArr = TechnicalIndicators.calculateATR(candles, this.atrPeriod);

    const upperBand = bb.upper[last];
    const middleBand = bb.middle[last];
    const lowerBand = bb.lower[last];
    const rsiCurr = rsi[last];
    const adxCurr = adxArr[last];
    const atrCurr = atrArr[last];

    if (
      isNaN(upperBand) || isNaN(middleBand) || isNaN(lowerBand) ||
      isNaN(rsiCurr) || isNaN(adxCurr) || isNaN(atrCurr)
    ) {
      return { action: 'HOLD', reason: 'Indicators warming up (NaN values present)' };
    }

    // ADX filter: only trade in ranging markets (ADX < 30)
    if (adxCurr >= this.adxMaxThreshold) {
      return {
        action: 'HOLD',
        reason: `ADX ${adxCurr.toFixed(1)} >= ${this.adxMaxThreshold} — trending market, skip (mean reversion needs ranging)`,
      };
    }

    const close = lastCandle.close;
    const atrInPips = atrCurr / this.pipSize;

    // BUY: price at or below lower band + RSI oversold
    if (close <= lowerBand && rsiCurr < this.rsiOversold) {
      const distToMiddlePips = Math.abs(close - middleBand) / this.pipSize;
      const takeProfitPips = Math.max(this.atrTpMultiplier * atrInPips, distToMiddlePips);
      const stopLossPips = this.atrSlMultiplier * atrInPips;

      const signal: Signal = {
        action: 'BUY',
        reason: `Price ${close.toFixed(2)} at/below lower BB ${lowerBand.toFixed(2)}; RSI ${rsiCurr.toFixed(1)} < ${this.rsiOversold}; ADX ${adxCurr.toFixed(1)}; TP ${takeProfitPips.toFixed(0)}pip SL ${stopLossPips.toFixed(0)}pip`,
        stopLossPips,
        takeProfitPips,
        strategyType: this.type,
      };

      logger.info(`Signal: BUY — ${signal.reason}`, { component: COMPONENT });
      return signal;
    }

    // SELL: price at or above upper band + RSI overbought
    if (close >= upperBand && rsiCurr > this.rsiOverbought) {
      const distToMiddlePips = Math.abs(close - middleBand) / this.pipSize;
      const takeProfitPips = Math.max(this.atrTpMultiplier * atrInPips, distToMiddlePips);
      const stopLossPips = this.atrSlMultiplier * atrInPips;

      const signal: Signal = {
        action: 'SELL',
        reason: `Price ${close.toFixed(2)} at/above upper BB ${upperBand.toFixed(2)}; RSI ${rsiCurr.toFixed(1)} > ${this.rsiOverbought}; ADX ${adxCurr.toFixed(1)}; TP ${takeProfitPips.toFixed(0)}pip SL ${stopLossPips.toFixed(0)}pip`,
        stopLossPips,
        takeProfitPips,
        strategyType: this.type,
      };

      logger.info(`Signal: SELL — ${signal.reason}`, { component: COMPONENT });
      return signal;
    }

    return {
      action: 'HOLD',
      reason: `No mean reversion signal: price ${close.toFixed(2)} within BB [${lowerBand.toFixed(2)}, ${upperBand.toFixed(2)}]; RSI ${rsiCurr.toFixed(1)}; ADX ${adxCurr.toFixed(1)}`,
    };
  }
}
