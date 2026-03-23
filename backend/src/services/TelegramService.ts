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
