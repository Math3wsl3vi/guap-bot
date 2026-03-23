import { Card } from "@/components/ui/card";
import { useBotStore } from "@/stores/botStore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { X, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function ActivePositionsTable() {
  const { activeTrades } = useBotStore();
  const queryClient = useQueryClient();

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.closePosition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      toast.success("Position closed at market price");
    },
    onError: () => {
      toast.error("Failed to close position");
    },
  });

  const handleClose = (id: string) => {
    closeMutation.mutate(id);
  };

  return (
    <Card className="bg-card border-border">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Active Positions ({activeTrades.length})</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground text-xs">Symbol</TableHead>
              <TableHead className="text-muted-foreground text-xs">Type</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Entry</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Current</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">P&L</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">SL</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">Trail</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right">TP</TableHead>
              <TableHead className="text-muted-foreground text-xs text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeTrades.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No active positions</TableCell>
              </TableRow>
            ) : (
              activeTrades.map((trade) => (
                <TableRow key={trade.id} className="border-border">
                  <TableCell className="font-mono font-medium text-foreground">{trade.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-xs font-mono ${trade.type === 'BUY' ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss'}`}>
                      {trade.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-right text-foreground">{(trade.entryPrice ?? 0).toFixed(trade.symbol.includes('JPY') ? 3 : 5)}</TableCell>
                  <TableCell className="font-mono text-right text-foreground">{trade.currentPrice?.toFixed(trade.symbol.includes('JPY') ? 3 : 5) ?? '—'}</TableCell>
                  <TableCell className={`font-mono text-right font-medium ${(trade.profitLoss ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {(trade.profitLoss ?? 0) >= 0 ? '+' : ''}${(trade.profitLoss ?? 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="font-mono text-right text-muted-foreground">{(trade.stopLoss ?? 0).toFixed(trade.symbol.includes('JPY') ? 3 : 5)}</TableCell>
                  <TableCell className="font-mono text-right">
                    {trade.trailingStopActive ? (
                      <span className="inline-flex items-center gap-1 text-blue-400">
                        <TrendingUp className="w-3 h-3" />
                        {trade.trailingStopLevel?.toFixed(trade.symbol.includes('JPY') ? 3 : 5) ?? '—'}
                      </span>
                    ) : trade.breakevenApplied ? (
                      <span className="text-yellow-400 text-xs">BE</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-right text-muted-foreground">{(trade.takeProfit ?? 0).toFixed(trade.symbol.includes('JPY') ? 3 : 5)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleClose(trade.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                      <X className="w-4 h-4" />
                    </Button>
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
