import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, buildExportUrl } from "@/lib/api";
import { TradeFilters } from "@/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Download, FileText, Filter, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STRATEGY_OPTIONS = [
  "CONSERVATIVE",
  "AGGRESSIVE_SCALPING",
  "LONDON_BREAKOUT",
  "MEAN_REVERSION",
  "GRID_TRADING",
  "NEWS_EVENT",
  "HYBRID",
  "COIN_FLIP",
  "RISE_FALL",
  "EVEN_ODD",
  "DIGIT_OVER_UNDER",
  "MARTINGALE",
  "ACCUMULATOR_LADDER",
  "MOMENTUM_RISE_FALL",
  "DIGIT_SNIPER",
  "VOLATILITY_BREAKOUT",
  "HEDGED_ACCUMULATOR",
  "ALL_IN_RECOVERY",
];

const PAGE_SIZE = 50;

export default function Trades() {
  const [filters, setFilters] = useState<TradeFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [showFilters, setShowFilters] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["trades-filtered", filters],
    queryFn: () => api.tradesFiltered(filters),
    refetchInterval: 10_000,
  });

  const trades = data?.trades ?? [];
  const total = data?.total ?? 0;
  const currentPage = Math.floor((filters.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const summary = useMemo(() => {
    const closed = trades.filter((t) => t.status === "CLOSED");
    const wins = closed.filter((t) => t.profitLoss > 0);
    const totalPnL = closed.reduce((s, t) => s + t.profitLoss, 0);
    return {
      total: total,
      showing: trades.length,
      wins: wins.length,
      losses: closed.length - wins.length,
      winRate: closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : "—",
      totalPnL: totalPnL.toFixed(2),
    };
  }, [trades, total]);

  function updateFilter(key: keyof TradeFilters, value: string | number | undefined) {
    setFilters((prev) => ({ ...prev, [key]: value, offset: 0 }));
  }

  function clearFilters() {
    setFilters({ limit: PAGE_SIZE, offset: 0 });
  }

  function goToPage(page: number) {
    setFilters((prev) => ({ ...prev, offset: (page - 1) * PAGE_SIZE }));
  }

  const hasActiveFilters = filters.from || filters.to || filters.strategy || filters.status || filters.outcome || filters.minSize || filters.maxSize;

  function formatDuration(ms?: number) {
    if (!ms) return "—";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function typeBadgeColor(type: string) {
    if (type === "BUY" || type === "CALL") return "bg-profit/10 text-profit";
    if (type === "SELL" || type === "PUT") return "bg-loss/10 text-loss";
    if (type === "ACCU") return "bg-blue-500/10 text-blue-400";
    return "bg-muted text-muted-foreground";
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trade History</h1>
          <p className="text-sm text-muted-foreground">
            {total} total trades
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a
                  href={buildExportUrl("csv", filters)}
                  download
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  Export CSV
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={buildExportUrl("pdf", filters)}
                  download
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  Export PDF Report
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                active
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4 bg-card border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={filters.from?.split("T")[0] ?? ""}
                onChange={(e) =>
                  updateFilter("from", e.target.value ? `${e.target.value}T00:00:00Z` : undefined)
                }
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={filters.to?.split("T")[0] ?? ""}
                onChange={(e) =>
                  updateFilter("to", e.target.value ? `${e.target.value}T23:59:59Z` : undefined)
                }
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Strategy</label>
              <Select
                value={filters.strategy ?? "all"}
                onValueChange={(v) => updateFilter("strategy", v === "all" ? undefined : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Strategies</SelectItem>
                  {STRATEGY_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select
                value={filters.status ?? "all"}
                onValueChange={(v) => updateFilter("status", v === "all" ? undefined : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Outcome</label>
              <Select
                value={filters.outcome ?? "all"}
                onValueChange={(v) => updateFilter("outcome", v === "all" ? undefined : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="win">Wins</SelectItem>
                  <SelectItem value="loss">Losses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Min Stake</label>
              <Input
                type="number"
                placeholder="0"
                value={filters.minSize ?? ""}
                onChange={(e) =>
                  updateFilter("minSize", e.target.value ? parseFloat(e.target.value) : undefined)
                }
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Max Stake</label>
              <Input
                type="number"
                placeholder="any"
                value={filters.maxSize ?? ""}
                onChange={(e) =>
                  updateFilter("maxSize", e.target.value ? parseFloat(e.target.value) : undefined)
                }
                className="h-9 text-sm"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {summary.showing} of {summary.total} trades &middot;{" "}
                <span className="text-profit">{summary.wins}W</span> /{" "}
                <span className="text-loss">{summary.losses}L</span> &middot; Win rate:{" "}
                {summary.winRate}% &middot; P&L:{" "}
                <span className={parseFloat(summary.totalPnL) >= 0 ? "text-profit" : "text-loss"}>
                  ${summary.totalPnL}
                </span>
              </p>
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-xs">
                <X className="w-3 h-3" /> Clear filters
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Table */}
      <Card className="bg-card border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                <TableHead className="text-muted-foreground text-xs">Symbol</TableHead>
                <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                <TableHead className="text-muted-foreground text-xs">Strategy</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Stake</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Entry</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Exit</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">P&L</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Duration</TableHead>
                <TableHead className="text-muted-foreground text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow className="border-border">
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                    Loading trades...
                  </TableCell>
                </TableRow>
              ) : trades.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                    No trades found
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={trade.id} className="border-border">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(trade.openedAt)}
                    </TableCell>
                    <TableCell className="font-mono font-medium text-foreground text-sm">
                      {trade.symbol}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-0 text-xs font-mono ${typeBadgeColor(trade.type)}`}
                      >
                        {trade.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {trade.strategyType?.replace(/_/g, " ") ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-right text-sm text-foreground">
                      ${trade.quantity.toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-sm text-foreground">
                      {trade.entryPrice > 0
                        ? trade.entryPrice.toFixed(trade.symbol.includes("JPY") ? 3 : 5)
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-right text-sm text-foreground">
                      {trade.exitPrice && trade.exitPrice > 0
                        ? trade.exitPrice.toFixed(trade.symbol.includes("JPY") ? 3 : 5)
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={`font-mono text-right text-sm font-medium ${
                        trade.profitLoss >= 0 ? "text-profit" : "text-loss"
                      }`}
                    >
                      {trade.status === "OPEN"
                        ? "—"
                        : `${trade.profitLoss >= 0 ? "+" : ""}$${trade.profitLoss.toFixed(2)}`}
                    </TableCell>
                    <TableCell className="font-mono text-right text-xs text-muted-foreground">
                      {formatDuration(trade.duration)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-0 text-xs ${
                          trade.status === "OPEN"
                            ? "bg-blue-500/10 text-blue-400"
                            : trade.profitLoss > 0
                            ? "bg-profit/10 text-profit"
                            : "bg-loss/10 text-loss"
                        }`}
                      >
                        {trade.status === "OPEN"
                          ? "OPEN"
                          : trade.profitLoss > 0
                          ? "WIN"
                          : "LOSS"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages} &middot; {total} trades
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                const page = startPage + i;
                if (page > totalPages) return null;
                return (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "ghost"}
                    size="sm"
                    className="w-8 h-8 p-0 text-xs"
                    onClick={() => goToPage(page)}
                  >
                    {page}
                  </Button>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
