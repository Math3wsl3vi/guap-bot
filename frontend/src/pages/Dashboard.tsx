import { StatsCard } from "@/components/dashboard/StatsCard";
import { LiveChart } from "@/components/dashboard/LiveChart";
import { ActivePositionsTable } from "@/components/dashboard/ActivePositionsTable";
import { RecentTradesTable } from "@/components/dashboard/RecentTradesTable";
import { BotControlPanel } from "@/components/dashboard/BotControlPanel";
import { useBotStore } from "@/stores/botStore";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { DollarSign, TrendingUp, Activity, Target, BarChart3, Zap } from "lucide-react";

const Dashboard = () => {
  const { setAccount, setBotStatus, setActiveTrades } = useBotStore();

  const { data: account } = useQuery({
    queryKey: ["account"],
    queryFn: () => api.account(),
    refetchInterval: 5_000,
  });

  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.status(),
    refetchInterval: 5_000,
  });

  const { data: positions } = useQuery({
    queryKey: ["positions"],
    queryFn: () => api.positions(),
    refetchInterval: 3_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.metrics(),
    refetchInterval: 10_000,
  });

  // Sync to Zustand only when React Query detects a structural data change,
  // not on every poll — prevents re-renders when data is identical.
  useEffect(() => { if (account) setAccount(account); }, [account]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status) setBotStatus(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveTrades(positions ?? []); }, [positions]); // eslint-disable-line react-hooks/exhaustive-deps

  const bal = account?.balance ?? 0;
  const equity = account?.equity ?? 0;
  const todayPnL = account?.todayPnL ?? 0;
  const todayPnLPct = account?.todayPnLPercent ?? 0;
  const activeCount = positions?.length ?? 0;
  const winRate = metrics?.winRate ?? 0;
  const winTrades = metrics?.winningTrades ?? 0;
  const lossTrades = metrics?.losingTrades ?? 0;
  const totalTrades = metrics?.totalTrades ?? 0;
  const tradesToday = status?.totalTradesToday ?? 0;
  const profitFactor = metrics?.profitFactor ?? 0;
  const totalProfit = metrics?.totalProfit ?? 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <StatsCard
          title="Balance"
          value={`$${bal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          change={`Equity: $${equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          changeType={equity >= bal ? "positive" : "negative"}
          icon={DollarSign}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatsCard
          title="Today P&L"
          value={`${todayPnL >= 0 ? "+" : ""}$${todayPnL.toFixed(2)}`}
          change={`${todayPnLPct >= 0 ? "+" : ""}${todayPnLPct.toFixed(2)}%`}
          changeType={todayPnL >= 0 ? "positive" : "negative"}
          icon={TrendingUp}
          iconClassName={todayPnL >= 0 ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"}
        />
        <StatsCard
          title="Active Trades"
          value={String(activeCount)}
          changeType="neutral"
          icon={Activity}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatsCard
          title="Win Rate"
          value={`${winRate}%`}
          change={`${winTrades}W / ${lossTrades}L`}
          changeType={winRate >= 50 ? "positive" : winRate > 0 ? "negative" : "neutral"}
          icon={Target}
          iconClassName={winRate >= 50 ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"}
        />
        <StatsCard
          title="Trades Today"
          value={String(tradesToday)}
          change={`${totalTrades} lifetime`}
          changeType="neutral"
          icon={BarChart3}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatsCard
          title="Profit Factor"
          value={profitFactor.toFixed(2)}
          change={`$${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)} total`}
          changeType={profitFactor >= 1 ? "positive" : profitFactor > 0 ? "negative" : "neutral"}
          icon={Zap}
          iconClassName={profitFactor >= 1 ? "bg-warning/10 text-warning" : "bg-loss/10 text-loss"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="lg:col-span-3">
          <LiveChart />
        </div>
        <div>
          <BotControlPanel />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <ActivePositionsTable />
        <RecentTradesTable />
      </div>
    </div>
  );
};

export default Dashboard;
