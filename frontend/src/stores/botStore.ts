import { create } from 'zustand';
import { BotStatus, Account, Trade } from '@/types';

// Lean Zustand store — holds optimistic UI state only.
// Actual server data is fetched via React Query in each component.

interface BotStore {
  botStatus: BotStatus;
  account: Account;
  activeTrades: Trade[];
  setBotStatus: (status: Partial<BotStatus>) => void;
  setAccount: (account: Partial<Account>) => void;
  setActiveTrades: (trades: Trade[]) => void;
}

const defaultBotStatus: BotStatus = {
  isRunning: false,
  isPaused: false,
  lastStarted: undefined,
  uptime: 0,
  totalTradesToday: 0,
};

const defaultAccount: Account = {
  balance: 0,
  equity: 0,
  margin: 0,
  freeMargin: 0,
  marginLevel: 0,
  todayPnL: 0,
  todayPnLPercent: 0,
};

export const useBotStore = create<BotStore>((set) => ({
  botStatus: defaultBotStatus,
  account: defaultAccount,
  activeTrades: [],
  setBotStatus: (status) =>
    set((s) => ({ botStatus: { ...s.botStatus, ...status } })),
  setAccount: (account) =>
    set((s) => ({ account: { ...s.account, ...account } })),
  setActiveTrades: (trades) => set({ activeTrades: trades }),
}));
