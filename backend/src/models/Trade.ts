export type TradeType = 'BUY' | 'SELL' | 'ACCU' | 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH';
export type TradeStatus = 'OPEN' | 'CLOSED';

export interface Trade {
  id: string;
  brokerId?: string;
  symbol: string;
  type: TradeType;
  entryPrice: number;
  exitPrice?: number;
  currentPrice?: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  profitLoss: number;
  profitLossPercent: number;
  commission?: number;
  slippage?: number;
  status: TradeStatus;
  openedAt: Date;
  closedAt?: Date;
  duration?: number;
  strategySignal?: string;
  strategyType?: string;
}
