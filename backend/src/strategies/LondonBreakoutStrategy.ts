import { Candle } from '../models/Candle';
import { strategyConfig } from '../config/strategy.config';
import { getInstrumentConfig } from '../config/instruments.config';
import { logger } from '../utils/logger';
import { BaseStrategy, HTFCandleMap, Signal } from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'LondonBreakoutStrategy';

interface LondonBreakoutState {
  asianHigh: number;
  asianLow: number;
  asianRangeValid: boolean;
  tradedToday: boolean;
  lastResetDate: string; // YYYY-MM-DD UTC
}

export class LondonBreakoutStrategy extends BaseStrategy {
  readonly name = 'London Breakout';
  readonly type: StrategyType = 'LONDON_BREAKOUT';

  private readonly asianRangeStartHour: number;
  private readonly asianRangeEndHour: number;
  private readonly breakoutWindowEndHour: number;
  private readonly minRangePips: number;
  private readonly maxRangePips: number;
  private readonly slRangeMultiplier: number;
  private readonly tpRangeMultiplier: number;
  private readonly pipSize: number;

  private state: LondonBreakoutState;

  constructor() {
    super();
    const cfg = strategyConfig.londonBreakout;
    this.asianRangeStartHour = cfg.asianRangeStartHour;
    this.asianRangeEndHour = cfg.asianRangeEndHour;
    this.breakoutWindowEndHour = cfg.breakoutWindowEndHour;
    this.minRangePips = cfg.minRangePips;
    this.maxRangePips = cfg.maxRangePips;
    this.slRangeMultiplier = cfg.slRangeMultiplier;
    this.tpRangeMultiplier = cfg.tpRangeMultiplier;
    this.pipSize = getInstrumentConfig(strategyConfig.symbol).pipSize;

    this.state = {
      asianHigh: -Infinity,
      asianLow: Infinity,
      asianRangeValid: false,
      tradedToday: false,
      lastResetDate: '',
    };
  }

  evaluate(candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    if (candles.length < 2) {
      return { action: 'HOLD', reason: 'Insufficient candles for London Breakout' };
    }

    const lastCandle = candles[candles.length - 1];
    const utcHour = lastCandle.timestamp.getUTCHours();
    const todayStr = this.dateStr(lastCandle.timestamp);

    // Reset state on new day
    if (todayStr !== this.state.lastResetDate) {
      this.state = {
        asianHigh: -Infinity,
        asianLow: Infinity,
        asianRangeValid: false,
        tradedToday: false,
        lastResetDate: todayStr,
      };
      logger.debug('London Breakout: new day reset', { component: COMPONENT, date: todayStr });
    }

    // Asian session accumulation phase
    if (utcHour >= this.asianRangeStartHour && utcHour < this.asianRangeEndHour) {
      this.buildAsianRange(candles);
      return { action: 'HOLD', reason: 'Building Asian session range' };
    }

    // Finalize Asian range if not yet done
    if (!this.state.asianRangeValid) {
      this.buildAsianRange(candles);
      const rangePips = (this.state.asianHigh - this.state.asianLow) / this.pipSize;

      if (this.state.asianHigh === -Infinity || this.state.asianLow === Infinity) {
        return { action: 'HOLD', reason: 'No Asian session candles found' };
      }

      if (rangePips < this.minRangePips) {
        return {
          action: 'HOLD',
          reason: `Asian range too narrow: ${rangePips.toFixed(1)} pips < ${this.minRangePips} min`,
        };
      }

      if (rangePips > this.maxRangePips) {
        return {
          action: 'HOLD',
          reason: `Asian range too wide: ${rangePips.toFixed(1)} pips > ${this.maxRangePips} max`,
        };
      }

      this.state.asianRangeValid = true;
      logger.info(`Asian range finalized: H=${this.state.asianHigh.toFixed(2)} L=${this.state.asianLow.toFixed(2)} (${rangePips.toFixed(1)} pips)`, {
        component: COMPONENT,
      });
    }

    // Already traded today — one trade max
    if (this.state.tradedToday) {
      return { action: 'HOLD', reason: 'Already traded today (1 trade/day limit)' };
    }

    // Outside entry window
    if (utcHour >= this.breakoutWindowEndHour) {
      return { action: 'HOLD', reason: 'Outside London breakout entry window' };
    }

    // Entry window — check for breakout
    const close = lastCandle.close;
    const rangeWidth = this.state.asianHigh - this.state.asianLow;
    const rangePips = rangeWidth / this.pipSize;

    if (close > this.state.asianHigh) {
      this.state.tradedToday = true;
      const slPips = rangePips * this.slRangeMultiplier;
      const tpPips = rangePips * this.tpRangeMultiplier;

      const signal: Signal = {
        action: 'BUY',
        reason: `Breakout above Asian high ${this.state.asianHigh.toFixed(2)}; range ${rangePips.toFixed(1)} pips; SL ${slPips.toFixed(1)} TP ${tpPips.toFixed(1)}`,
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        strategyType: this.type,
      };

      logger.info(`Signal: BUY — ${signal.reason}`, { component: COMPONENT });
      return signal;
    }

    if (close < this.state.asianLow) {
      this.state.tradedToday = true;
      const slPips = rangePips * this.slRangeMultiplier;
      const tpPips = rangePips * this.tpRangeMultiplier;

      const signal: Signal = {
        action: 'SELL',
        reason: `Breakout below Asian low ${this.state.asianLow.toFixed(2)}; range ${rangePips.toFixed(1)} pips; SL ${slPips.toFixed(1)} TP ${tpPips.toFixed(1)}`,
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        strategyType: this.type,
      };

      logger.info(`Signal: SELL — ${signal.reason}`, { component: COMPONENT });
      return signal;
    }

    return {
      action: 'HOLD',
      reason: `Waiting for breakout: price ${close.toFixed(2)} within Asian range [${this.state.asianLow.toFixed(2)}, ${this.state.asianHigh.toFixed(2)}]`,
    };
  }

  /** Scan candle buffer for today's Asian session to build high/low. */
  private buildAsianRange(candles: readonly Candle[]): void {
    const todayStr = this.state.lastResetDate;
    let high = -Infinity;
    let low = Infinity;

    for (const c of candles) {
      const h = c.timestamp.getUTCHours();
      if (
        this.dateStr(c.timestamp) === todayStr &&
        h >= this.asianRangeStartHour &&
        h < this.asianRangeEndHour
      ) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
      }
    }

    if (high !== -Infinity) this.state.asianHigh = high;
    if (low !== Infinity) this.state.asianLow = low;
  }

  private dateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
