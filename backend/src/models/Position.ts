import { TradeType } from './Trade';

export interface Position {
  id: string;
  brokerId?: string;
  symbol: string;
  type: TradeType;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  unrealisedPnL: number;
  unrealisedPnLPercent: number;
  openedAt: Date;
  trailingStopActive: boolean;
  trailingStopLevel?: number;
}
