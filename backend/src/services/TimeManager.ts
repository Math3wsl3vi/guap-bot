/**
 * Static utility class for trading session detection and time-based logic.
 * All times are UTC-based.
 *
 * Session hours (approximate):
 *   ASIAN:     00:00 – 06:59 UTC
 *   LONDON:    07:00 – 11:59 UTC
 *   OVERLAP:   12:00 – 15:59 UTC  (London + New York)
 *   NEW_YORK:  16:00 – 20:59 UTC
 *   OFF_HOURS: 21:00 – 23:59 UTC
 */
export type TradingSession = 'ASIAN' | 'LONDON' | 'OVERLAP' | 'NEW_YORK' | 'OFF_HOURS';

export class TimeManager {
  /** Determine the current forex trading session from a UTC hour (0-23). */
  static getSession(utcHour: number): TradingSession {
    if (utcHour >= 0 && utcHour < 7) return 'ASIAN';
    if (utcHour >= 7 && utcHour < 12) return 'LONDON';
    if (utcHour >= 12 && utcHour < 16) return 'OVERLAP';
    if (utcHour >= 16 && utcHour < 21) return 'NEW_YORK';
    return 'OFF_HOURS';
  }

  /** Get the session label for a given Date (for DB persistence / logging). */
  static getSessionLabel(timestamp: Date): TradingSession {
    return this.getSession(timestamp.getUTCHours());
  }

  /**
   * Check if a UTC hour falls within a range.
   * Handles midnight-crossing ranges (e.g. start=22, end=2 → true for 22,23,0,1).
   */
  static isWithinHours(utcHour: number, start: number, end: number): boolean {
    if (start <= end) {
      return utcHour >= start && utcHour < end;
    }
    // Wraps midnight
    return utcHour >= start || utcHour < end;
  }

  /**
   * Check if the current time is a weekday (forex markets are closed Sat-Sun).
   * UTC day 0 = Sunday, 6 = Saturday.
   */
  static isMarketOpen(timestamp: Date): boolean {
    const day = timestamp.getUTCDay();
    // Market opens Sunday 22:00 UTC, closes Friday 22:00 UTC.
    // Simplified: weekdays only (Mon=1 through Fri=5).
    if (day === 0 || day === 6) return false;
    return true;
  }

  /** Get a human-readable label for logging, e.g. "LONDON (08:15 UTC)". */
  static formatSessionTime(timestamp: Date): string {
    const session = this.getSessionLabel(timestamp);
    const hh = timestamp.getUTCHours().toString().padStart(2, '0');
    const mm = timestamp.getUTCMinutes().toString().padStart(2, '0');
    return `${session} (${hh}:${mm} UTC)`;
  }
}
