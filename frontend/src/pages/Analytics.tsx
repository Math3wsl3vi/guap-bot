import { Card } from "@/components/ui/card";
import { mockMetrics, generateEquityCurve, generatePnLBars } from "@/lib/mock-data";
import { useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

const Analytics = () => {
  const equityData = useMemo(() => generateEquityCurve(), []);
  const pnlData = useMemo(() => generatePnLBars(), []);

  const winLossData = [
    { name: 'Wins', value: mockMetrics.winningTrades, color: 'hsl(160,84%,39%)' },
    { name: 'Losses', value: mockMetrics.losingTrades, color: 'hsl(0,72%,51%)' },
  ];

  const metricCards = [
    { label: 'Total P&L', value: `+$${mockMetrics.totalProfit.toLocaleString()}`, positive: true },
    { label: 'Win Rate', value: `${mockMetrics.winRate}%`, positive: true },
    { label: 'Profit Factor', value: mockMetrics.profitFactor.toFixed(2), positive: true },
    { label: 'Avg Win', value: `+$${mockMetrics.averageWin.toFixed(2)}`, positive: true },
    { label: 'Avg Loss', value: `-$${Math.abs(mockMetrics.averageLoss).toFixed(2)}`, positive: false },
    { label: 'Max Drawdown', value: `${mockMetrics.maxDrawdown}%`, positive: false },
    { label: 'Sharpe Ratio', value: mockMetrics.sharpeRatio.toFixed(2), positive: true },
    { label: 'Best Trade', value: `+$${mockMetrics.bestTrade.toFixed(2)}`, positive: true },
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
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Win / Loss</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={winLossData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" strokeWidth={0}>
                {winLossData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'hsl(220,18%,12%)', border: '1px solid hsl(220,13%,18%)', borderRadius: '8px', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-profit" /> {mockMetrics.winningTrades} Wins</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-loss" /> {mockMetrics.losingTrades} Losses</span>
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-card border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4">Daily P&L</h3>
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
      </Card>
    </div>
  );
};

export default Analytics;
