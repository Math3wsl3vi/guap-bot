import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import { BaseStrategy, Signal } from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'NewsEventStrategy';

/** Matches "HH:MM" format for daily recurring events. */
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

export class NewsEventStrategy extends BaseStrategy {
  readonly name = 'News Event';
  readonly type: StrategyType = 'NEWS_EVENT';

  private readonly blackoutMinutesBefore: number;
  private readonly entryWindowMinutesAfter: number;
  private readonly minImpulseBodyPips: number;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly atrTpMultiplier: number;
  private readonly pipSize: number;

  constructor() {
    super();
    const cfg = strategyConfig.newsEvent;
    this.blackoutMinutesBefore = cfg.blackoutMinutesBefore;
    this.entryWindowMinutesAfter = cfg.entryWindowMinutesAfter;
    this.atrPeriod = cfg.atrSlMultiplier > 0 ? strategyConfig.atrPeriod : 14;
    this.atrSlMultiplier = cfg.atrSlMultiplier;
    this.atrTpMultiplier = cfg.atrTpMultiplier;
    this.minImpulseBodyPips = cfg.minImpulseBodyPips;
    this.pipSize = parseFloat(process.env.PIP_SIZE ?? '0.01');
  }

  evaluate(candles: readonly Candle[]): Signal {
    if (candles.length < this.atrPeriod + 1) {
      return {
        action: 'HOLD',
        reason: `Insufficient candles: need ${this.atrPeriod + 1}, have ${candles.length}`,
      };
    }

    const events = strategyConfig.newsEvent.scheduledEvents;
    if (!events || events.length === 0) {
      return { action: 'HOLD', reason: 'No news events scheduled' };
    }

    const lastCandle = candles[candles.length - 1];
    const now = lastCandle.timestamp;

    // Find nearest event (could be upcoming or just passed)
    const nearest = this.findNearestEvent(now, events);
    if (!nearest) {
      return { action: 'HOLD', reason: 'No active news event window' };
    }

    const diffMs = now.getTime() - nearest.getTime();
    const diffMinutes = diffMs / 60_000;

    // Blackout: event is upcoming and within blackout window
    if (diffMinutes < 0 && Math.abs(diffMinutes) <= this.blackoutMinutesBefore) {
      return {
        action: 'HOLD',
        reason: `News blackout: event in ${Math.abs(diffMinutes).toFixed(1)} minutes`,
      };
    }

    // Entry window: event has passed and within entry window
    if (diffMinutes >= 0 && diffMinutes <= this.entryWindowMinutesAfter) {
      const bodyPips = Math.abs(lastCandle.close - lastCandle.open) / this.pipSize;

      if (bodyPips < this.minImpulseBodyPips) {
        return {
          action: 'HOLD',
          reason: `Post-event but impulse too small: ${bodyPips.toFixed(1)} pips < ${this.minImpulseBodyPips} min`,
        };
      }

      const atrArr = TechnicalIndicators.calculateATR(candles, this.atrPeriod);
      const atrCurr = atrArr[candles.length - 1];

      if (isNaN(atrCurr)) {
        return { action: 'HOLD', reason: 'ATR warming up' };
      }

      const atrInPips = atrCurr / this.pipSize;
      const stopLossPips = this.atrSlMultiplier * atrInPips;
      const takeProfitPips = this.atrTpMultiplier * atrInPips;

      const direction: 'BUY' | 'SELL' = lastCandle.close > lastCandle.open ? 'BUY' : 'SELL';

      const signal: Signal = {
        action: direction,
        reason: `News impulse ${direction}: body ${bodyPips.toFixed(1)} pips; ${diffMinutes.toFixed(1)} min after event; ATR-SL ${stopLossPips.toFixed(0)}pip TP ${takeProfitPips.toFixed(0)}pip`,
        stopLossPips,
        takeProfitPips,
        strategyType: this.type,
      };

      logger.info(`Signal: ${direction} — ${signal.reason}`, { component: COMPONENT });
      return signal;
    }

    return { action: 'HOLD', reason: 'No active news event window' };
  }

  /**
   * Find the nearest event to `now` — either the closest upcoming or most recent past event
   * within the blackout + entry window range.
   */
  private findNearestEvent(now: Date, events: string[]): Date | null {
    let nearest: Date | null = null;
    let minAbsDiff = Infinity;

    const windowMs = Math.max(this.blackoutMinutesBefore, this.entryWindowMinutesAfter) * 60_000;

    for (const raw of events) {
      const candidates = this.parseEventTime(raw, now);
      for (const eventTime of candidates) {
        const absDiff = Math.abs(now.getTime() - eventTime.getTime());
        if (absDiff < minAbsDiff && absDiff <= windowMs) {
          minAbsDiff = absDiff;
          nearest = eventTime;
        }
      }
    }

    return nearest;
  }

  /**
   * Parse an event time string.
   * "HH:MM" → today's and yesterday's UTC time (to catch post-event window crossing midnight).
   * ISO string → absolute time.
   */
  private parseEventTime(raw: string, referenceDate: Date): Date[] {
    const trimmed = raw.trim();
    const match = HHMM_RE.exec(trimmed);

    if (match) {
      const hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const results: Date[] = [];

      // Today
      const today = new Date(referenceDate);
      today.setUTCHours(hour, minute, 0, 0);
      results.push(today);

      // Yesterday (for post-event window near midnight)
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      results.push(yesterday);

      // Tomorrow (for blackout window near midnight)
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      results.push(tomorrow);

      return results;
    }

    // Try ISO parsing
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return [parsed];
    }

    logger.warn(`Unparseable event time: "${trimmed}"`, { component: COMPONENT });
    return [];
  }
}
