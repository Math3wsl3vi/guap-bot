import axios from 'axios';
import { logger } from '../utils/logger';
import { Trade } from '../models/Trade';
import { Signal } from '../strategies/BaseStrategy';

export class TelegramService {
  private readonly baseUrl: string;
  private readonly chatId: string;
  private enabled: boolean;

  constructor(token: string, chatId: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.chatId = chatId;
    this.enabled = Boolean(token && chatId);
  }

  private async send(text: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
      });
    } catch (err) {
      // Never let notification failures affect the trading loop
      logger.warn('Telegram notification failed', {
        component: 'TelegramService',
        error: (err as Error).message,
      });
    }
  }

  async notifySignal(signal: Signal, symbol: string, price: number): Promise<void> {
    const arrow = signal.action === 'BUY' ? '🟢' : '🔴';
    const text =
      `${arrow} <b>SIGNAL: ${signal.action}</b>\n` +
      `📊 <b>Symbol:</b> ${symbol}\n` +
      `💰 <b>Price:</b> ${price.toFixed(2)}\n` +
      `📝 <b>Reason:</b> ${signal.reason ?? 'N/A'}`;
    await this.send(text);
  }

  async notifyTradeOpened(trade: Trade, stopLoss: number, takeProfit: number): Promise<void> {
    const arrow = trade.type === 'BUY' ? '🟢' : '🔴';
    const text =
      `${arrow} <b>TRADE OPENED</b>\n` +
      `📊 <b>Symbol:</b> ${trade.symbol}\n` +
      `📈 <b>Direction:</b> ${trade.type}\n` +
      `💰 <b>Entry:</b> ${trade.entryPrice?.toFixed(2) ?? 'market'}\n` +
      `🛡 <b>Stop Loss:</b> ${stopLoss.toFixed(2)}\n` +
      `🎯 <b>Take Profit:</b> ${takeProfit.toFixed(2)}\n` +
      `📦 <b>Size:</b> ${trade.quantity}\n` +
      `🆔 <b>ID:</b> ${trade.brokerId ?? trade.id}`;
    await this.send(text);
  }

  async notifyTradeClosed(
    symbol: string,
    direction: 'BUY' | 'SELL' | 'ACCU',
    entryPrice: number,
    exitPrice: number,
    pnl: number,
    balance?: number,
  ): Promise<void> {
    const won = pnl >= 0;
    const icon = won ? '✅' : '❌';
    const pnlSign = pnl >= 0 ? '+' : '';
    let text =
      `${icon} <b>TRADE CLOSED</b>\n` +
      `📊 <b>Symbol:</b> ${symbol}\n` +
      `📈 <b>Direction:</b> ${direction}\n` +
      `💰 <b>Entry:</b> ${entryPrice.toFixed(2)} → <b>Exit:</b> ${exitPrice.toFixed(2)}\n` +
      `${won ? '💵' : '💸'} <b>P&L:</b> ${pnlSign}$${pnl.toFixed(2)}`;
    if (balance !== undefined) {
      text += `\n💳 <b>Balance:</b> $${balance.toFixed(2)}`;
    }
    await this.send(text);
  }

  async notifyRiskBlocked(signalAction: string, reason: string): Promise<void> {
    const text =
      `⚠️ <b>TRADE BLOCKED</b>\n` +
      `🚫 <b>Signal:</b> ${signalAction}\n` +
      `📝 <b>Reason:</b> ${reason}`;
    await this.send(text);
  }

  async notifyError(message: string): Promise<void> {
    const text = `🚨 <b>BOT ERROR</b>\n${message}`;
    await this.send(text);
  }

  async notifyInfo(message: string): Promise<void> {
    const text = `ℹ️ ${message}`;
    await this.send(text);
  }

  async sendDailyReport(report: DailyReport): Promise<void> {
    const { date, balance, trades, closed, wins, losses, winRate, grossProfit, grossLoss, netPnL, profitFactor, avgWin, avgLoss, bestTrade, worstTrade, totalStaked, roi, byStrategy, openPositions } = report;

    let text =
      `📊 <b>DAILY REPORT — ${date}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +

      `💳 <b>Balance:</b> $${balance.toFixed(2)}\n` +
      `📈 <b>Total Trades:</b> ${trades} (${closed} closed, ${openPositions} open)\n` +
      `✅ <b>Wins:</b> ${wins}  ❌ <b>Losses:</b> ${losses}\n` +
      `🎯 <b>Win Rate:</b> ${winRate.toFixed(1)}%\n\n` +

      `💰 <b>Net P&L:</b> ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}\n` +
      `📗 <b>Gross Profit:</b> $${grossProfit.toFixed(2)}\n` +
      `📕 <b>Gross Loss:</b> $${grossLoss.toFixed(2)}\n` +
      `⚖️ <b>Profit Factor:</b> ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}\n` +
      `📊 <b>ROI:</b> ${roi.toFixed(2)}%\n\n` +

      `🏆 <b>Best Trade:</b> +$${bestTrade.toFixed(2)}\n` +
      `💥 <b>Worst Trade:</b> $${worstTrade.toFixed(2)}\n` +
      `📗 <b>Avg Win:</b> $${avgWin.toFixed(2)}\n` +
      `📕 <b>Avg Loss:</b> $${avgLoss.toFixed(2)}\n` +
      `💵 <b>Total Staked:</b> $${totalStaked.toFixed(2)}\n`;

    if (byStrategy.length > 0) {
      text += `\n<b>By Strategy:</b>\n`;
      for (const s of byStrategy) {
        const icon = s.pnl >= 0 ? '🟢' : '🔴';
        text += `${icon} ${s.name}: ${s.wins}W/${s.losses}L (${s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(0) : 0}%) → ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(2)}\n`;
      }
    }

    if (closed === 0) {
      text = `📊 <b>DAILY REPORT — ${date}</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n💳 <b>Balance:</b> $${balance.toFixed(2)}\n📭 No trades today.`;
    }

    await this.send(text);
  }
}

export interface DailyReport {
  date: string;
  balance: number;
  trades: number;
  closed: number;
  openPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  totalStaked: number;
  roi: number;
  byStrategy: { name: string; trades: number; wins: number; losses: number; pnl: number }[];
}

/** Build a TelegramService from env vars. Returns null if not configured. */
export function createTelegramService(): TelegramService | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    logger.info('Telegram notifications disabled (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set)', {
      component: 'TelegramService',
    });
    return null;
  }
  logger.info('Telegram notifications enabled', { component: 'TelegramService', chatId });
  return new TelegramService(token, chatId);
}
