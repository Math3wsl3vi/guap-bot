import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function RecentTradesTable() {
  const { data: trades = [] } = useQuery({
    queryKey: ["trades"],
    queryFn: () => api.trades(20),
    refetchInterval: 5_000,
  });

  const closed = trades.filter((t) => t.status === "CLOSED");

  return (
    <Card className="bg-card border-border">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Recent Trades</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground text-xs">Symbol</TableHead>
              <TableHead className="text-muted-foreground text-xs">Type</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Entry</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Exit</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">P&L</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {closed.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No closed trades yet
                </TableCell>
              </TableRow>
            ) : (
              closed.map((trade) => (
                <TableRow key={trade.id} className="border-border">
                  <TableCell className="font-mono font-medium text-foreground">
                    {trade.symbol}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`border-0 text-xs font-mono ${
                        trade.type === "BUY" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
                      }`}
                    >
                      {trade.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-right text-foreground">
                    {trade.entryPrice.toFixed(trade.symbol.includes("JPY") ? 3 : 5)}
                  </TableCell>
                  <TableCell className="font-mono text-right text-foreground">
                    {trade.exitPrice?.toFixed(trade.symbol.includes("JPY") ? 3 : 5) ?? "—"}
                  </TableCell>
                  <TableCell
                    className={`font-mono text-right font-medium ${
                      trade.profitLoss >= 0 ? "text-profit" : "text-loss"
                    }`}
                  >
                    {trade.profitLoss >= 0 ? "+" : ""}${trade.profitLoss.toFixed(2)}
                  </TableCell>
                  <TableCell className="font-mono text-right text-muted-foreground">
                    {Math.floor((trade.duration ?? 0) / 60_000)}m
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
