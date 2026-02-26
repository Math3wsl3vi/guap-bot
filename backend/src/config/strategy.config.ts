import 'dotenv/config';
import { parseEnvNumber } from '../utils/helpers';

export interface StrategyConfig {
  emaFastPeriod: number;
  emaSlowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  takeProfitPips: number;
  stopLossPips: number;
  trailingStopEnabled: boolean;
  trailingStopPips: number;
  tradingDays: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
  timezone: string;
  positionSizing: 'fixed' | 'percentage' | 'kelly';
  symbol: string;
  timeframe: string;
}

export const strategyConfig: Readonly<StrategyConfig> = Object.freeze({
  emaFastPeriod: parseEnvNumber(process.env.EMA_FAST_PERIOD, 9),
  emaSlowPeriod: parseEnvNumber(process.env.EMA_SLOW_PERIOD, 21),
  rsiPeriod: parseEnvNumber(process.env.RSI_PERIOD, 14),
  rsiOverbought: parseEnvNumber(process.env.RSI_OVERBOUGHT, 70),
  rsiOversold: parseEnvNumber(process.env.RSI_OVERSOLD, 30),
  takeProfitPips: parseEnvNumber(process.env.TAKE_PROFIT_PIPS, 8),
  stopLossPips: parseEnvNumber(process.env.STOP_LOSS_PIPS, 5),
  trailingStopEnabled: process.env.TRAILING_STOP_ENABLED === 'true',
  trailingStopPips: parseEnvNumber(process.env.TRAILING_STOP_PIPS, 3),
  tradingDays: (process.env.TRADING_DAYS || 'Mon,Tue,Wed,Thu,Fri').split(','),
  tradingHoursStart: process.env.TRADING_HOURS_START || '08:00',
  tradingHoursEnd: process.env.TRADING_HOURS_END || '17:00',
  timezone: process.env.TRADING_TIMEZONE || 'UTC',
  positionSizing: (process.env.POSITION_SIZING as StrategyConfig['positionSizing']) || 'percentage',
  symbol: process.env.TRADING_SYMBOL || 'XAU_USD',
  timeframe: process.env.TRADING_TIMEFRAME || '1m',
});
