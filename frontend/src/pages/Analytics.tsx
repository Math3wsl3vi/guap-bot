import { Card } from "@/components/ui/card";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import type { Trade, EquityPoint, PnLBar } from "@/types";

function buildEquityCurve(trades: Trade[], currentBalance: number): EquityPoint[] {
  const closed = trades
    .filter((t) => t.status === "CLOSED" && t.closedAt)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

  if (closed.length === 0) return [];

  const totalPnL = closed.reduce((sum, t) => sum + t.profitLoss, 0);
  const startingBalance = currentBalance - totalPnL;

  const dailyMap = new Map<string, number>();
  for (const t of closed) {
    const day = t.closedAt!.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + t.profitLoss);
  }

  const points: EquityPoint[] = [];
  let equity = startingBalance;
  for (const [date, pnl] of dailyMap) {
    equity += pnl;
    points.push({ date, equity: Math.round(equity * 100) / 100 });
  }
  return points;
}

function buildDailyPnL(trades: Trade[]): PnLBar[] {
  const closed = trades
    .filter((t) => t.status === "CLOSED" && t.closedAt)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

  const dailyMap = new Map<string, number>();
  for (const t of closed) {
    const day = t.closedAt!.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + t.profitLoss);
  }

  return Array.from(dailyMap, ([date, pnl]) => ({
    date,
    pnl: Math.round(pnl * 100) / 100,
  }));
}

const Analytics = () => {
  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.metrics(),
    refetchInterval: 10_000,
  });

  const { data: trades } = useQuery({
    queryKey: ["trades", 500],
    queryFn: () => api.trades(500),
    refetchInterval: 10_000,
  });

  const { data: account } = useQuery({
    queryKey: ["account"],
    queryFn: () => api.account(),
    refetchInterval: 10_000,
  });

  const equityData = useMemo(
    () => (trades && account ? buildEquityCurve(trades, account.balance) : []),
    [trades, account],
  );

  const pnlData = useMemo(
    () => (trades ? buildDailyPnL(trades) : []),
    [trades],
  );

  const wins = metrics?.winningTrades ?? 0;
  const losses = metrics?.losingTrades ?? 0;

  const winLossData = [
    { name: 'Wins', value: wins, color: 'hsl(160,84%,39%)' },
    { name: 'Losses', value: losses, color: 'hsl(0,72%,51%)' },
  ];

  const totalProfit = metrics?.totalProfit ?? 0;
  const metricCards = [
    { label: 'Total P&L', value: `${totalProfit >= 0 ? '+' : ''}$${totalProfit.toLocaleString()}`, positive: totalProfit >= 0 },
    { label: 'Win Rate', value: `${(metrics?.winRate ?? 0).toFixed(1)}%`, positive: (metrics?.winRate ?? 0) >= 50 },
    { label: 'Profit Factor', value: (metrics?.profitFactor ?? 0).toFixed(2), positive: (metrics?.profitFactor ?? 0) >= 1 },
    { label: 'Avg Win', value: `+$${(metrics?.averageWin ?? 0).toFixed(2)}`, positive: true },
    { label: 'Avg Loss', value: `-$${Math.abs(metrics?.averageLoss ?? 0).toFixed(2)}`, positive: false },
    { label: 'Max Drawdown', value: `${(metrics?.maxDrawdown ?? 0).toFixed(1)}%`, positive: false },
    { label: 'Sharpe Ratio', value: (metrics?.sharpeRatio ?? 0).toFixed(2), positive: (metrics?.sharpeRatio ?? 0) >= 1 },
    { label: 'Best Trade', value: `+$${(metrics?.bestTrade ?? 0).toFixed(2)}`, positive: true },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Analytics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metricCards.map(m => (
          <Card key={m.label} className="p-4 bg-card border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-bold font-mono ${m.positive ? 'text-profit' : 'text-loss'}`}>{m.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Equity Curve</h3>
          {equityData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">No closed trades yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: 'hsl(215,15%,55%)', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(215,15%,55%)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} width={50} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(220,18%,12%)', border: '1px solid hsl(220,13%,18%)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Equity']} />
                <Area type="monotone" dataKey="equity" stroke="hsl(217,91%,60%)" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Win / Loss</h3>
          {wins + losses === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">No trades yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={winLossData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" strokeWidth={0}>
                  {winLossData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'hsl(220,18%,12%)', border: '1px solid hsl(220,13%,18%)', borderRadius: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex justify-center gap-6 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-profit" /> {wins} Wins</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-loss" /> {losses} Losses</span>
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-card border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4">Daily P&L</h3>
        {pnlData.length === 0 ? (
          <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">No closed trades yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={pnlData}>
              <XAxis dataKey="date" tick={{ fill: 'hsl(215,15%,55%)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: 'hsl(215,15%,55%)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} width={50} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(220,18%,12%)', border: '1px solid hsl(220,13%,18%)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`$${Number(v).toFixed(2)}`, 'P&L']} />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {pnlData.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? 'hsl(160,84%,39%)' : 'hsl(0,72%,51%)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
};

export default Analytics;
