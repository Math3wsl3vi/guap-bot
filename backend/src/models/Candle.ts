export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnnotatedCandle extends Candle {
  ema9?: number;
  ema21?: number;
  rsi14?: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
