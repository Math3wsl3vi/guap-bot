import { Bell, Wifi, Menu } from "lucide-react";
import { useBotStore } from "@/stores/botStore";
import { Badge } from "@/components/ui/badge";

interface TopBarProps {
  onMenuToggle?: () => void;
}

export function TopBar({ onMenuToggle }: TopBarProps) {
  const { botStatus, account } = useBotStore();

  const statusLabel = botStatus.isRunning
    ? botStatus.isPaused ? "Paused" : "Live"
    : "Stopped";

  const statusClass = botStatus.isRunning
    ? botStatus.isPaused ? "bg-warning\/10 text-warning" : "bg-profit\/10 text-profit"
    : "bg-loss\/10 text-loss";

  return (
    <header className="flex items-center justify-between h-14 md:h-16 px-4 md:px-6 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button onClick={onMenuToggle} className="p-1.5 -ml-1 rounded-lg hover:bg-accent transition-colors md:hidden">
          <Menu className="w-5 h-5 text-foreground" />
        </button>

        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${botStatus.isRunning && !botStatus.isPaused ? 'bg-profit pulse-live' : botStatus.isPaused ? 'bg-warning' : 'bg-loss'}`} />
          <Badge variant="outline" className={statusClass + " border-0 font-mono text-xs"}>
            {statusLabel}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        {/* Balance — always visible */}
        <div className="text-right">
          <p className="text-[10px] md:text-xs text-muted-foreground">Balance</p>
          <p className="font-mono text-xs md:text-sm font-semibold text-foreground">${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        {/* P&L — hidden on very small screens */}
        <div className="text-right hidden sm:block">
          <p className="text-[10px] md:text-xs text-muted-foreground">Today P&L</p>
          <p className={`font-mono text-xs md:text-sm font-semibold ${account.todayPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
            {account.todayPnL >= 0 ? '+' : ''}${account.todayPnL.toFixed(2)} ({account.todayPnLPercent.toFixed(2)}%)
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-profit">
          <Wifi className="w-4 h-4" />
        </div>
        <button className="relative p-1.5 md:p-2 rounded-lg hover:bg-accent transition-colors">
          <Bell className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground" />
          <span className="absolute top-1 right-1 md:top-1.5 md:right-1.5 w-2 h-2 rounded-full bg-primary" />
        </button>
      </div>
    </header>
  );
}
