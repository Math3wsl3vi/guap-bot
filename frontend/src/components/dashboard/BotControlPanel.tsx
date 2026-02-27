import { Card } from "@/components/ui/card";
import { useBotStore } from "@/stores/botStore";
import { Button } from "@/components/ui/button";
import { Play, Square, Pause, AlertOctagon } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function BotControlPanel() {
  const { botStatus, setBotStatus } = useBotStore();
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: api.botStart,
    onSuccess: () => {
      setBotStatus({ isRunning: true, isPaused: false, lastStarted: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      toast.success("Bot started", { description: "Automated trading is now active." });
    },
    onError: (err: Error) => toast.error("Failed to start bot", { description: err.message }),
  });

  const stopMutation = useMutation({
    mutationFn: api.botStop,
    onSuccess: () => {
      setBotStatus({ isRunning: false, isPaused: false });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      toast.info("Bot stopped", { description: "Trading has been stopped." });
    },
    onError: (err: Error) => toast.error("Failed to stop bot", { description: err.message }),
  });

  const pauseMutation = useMutation({
    mutationFn: api.botPause,
    onSuccess: (data) => {
      setBotStatus({ isPaused: data.isPaused });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      toast.info(data.isPaused ? "Bot paused" : "Bot resumed");
    },
    onError: (err: Error) => toast.error("Failed to toggle pause", { description: err.message }),
  });

  const handleEmergencyStop = () => {
    if (confirmText === "STOP") {
      stopMutation.mutate();
      setEmergencyOpen(false);
      setConfirmText("");
      toast.error("Emergency stop executed", { description: "Bot stopped. Close positions manually if needed." });
    }
  };

  const isPending = startMutation.isPending || stopMutation.isPending || pauseMutation.isPending;
  const upHrs = Math.floor(botStatus.uptime / 3600);
  const upMins = Math.floor((botStatus.uptime % 3600) / 60);

  return (
    <>
      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4">Bot Controls</h3>
        <div className="flex gap-2 mb-4">
          {!botStatus.isRunning ? (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={isPending}
              className="flex-1 bg-profit hover:bg-profit/90 text-success-foreground gap-2"
            >
              <Play className="w-4 h-4" /> Start
            </Button>
          ) : (
            <Button
              onClick={() => stopMutation.mutate()}
              disabled={isPending}
              variant="secondary"
              className="flex-1 gap-2"
            >
              <Square className="w-4 h-4" /> Stop
            </Button>
          )}
          <Button
            onClick={() => pauseMutation.mutate()}
            variant="secondary"
            className="flex-1 gap-2"
            disabled={!botStatus.isRunning || isPending}
          >
            <Pause className="w-4 h-4" /> {botStatus.isPaused ? "Resume" : "Pause"}
          </Button>
        </div>
        <Button
          variant="destructive"
          className="w-full gap-2"
          onClick={() => setEmergencyOpen(true)}
          disabled={!botStatus.isRunning}
        >
          <AlertOctagon className="w-4 h-4" /> Emergency Stop
        </Button>
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Uptime</span>
            <span className="font-mono text-foreground">{upHrs}h {upMins}m</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Trades Today</span>
            <span className="font-mono text-foreground">{botStatus.totalTradesToday}</span>
          </div>
        </div>
      </Card>

      <Dialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertOctagon className="w-5 h-5" /> Emergency Stop
            </DialogTitle>
            <DialogDescription>
              This will immediately stop all trading. Type{" "}
              <strong className="text-foreground">STOP</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "STOP" to confirm'
            className="font-mono"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEmergencyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleEmergencyStop}
              disabled={confirmText !== "STOP"}
            >
              Confirm Emergency Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
