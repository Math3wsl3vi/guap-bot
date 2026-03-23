import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TradingPreset } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Clock, Zap } from "lucide-react";

const RISK_COLORS: Record<TradingPreset["riskLevel"], string> = {
  LOW: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  HIGH: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  EXTREME: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface PresetCardsProps {
  activePresetId?: string | null;
  onApply: (id: string) => void;
  isPending: boolean;
}

export function PresetCards({ activePresetId, onApply, isPending }: PresetCardsProps) {
  const [confirmPreset, setConfirmPreset] = useState<TradingPreset | null>(null);

  const { data: presets = [] } = useQuery({
    queryKey: ["presets"],
    queryFn: () => api.presets(),
    staleTime: Infinity,
  });

  if (presets.length === 0) return null;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Quick Presets</h2>
          {activePresetId && (
            <Badge variant="outline" className="text-xs">
              Active: {presets.find((p) => p.id === activePresetId)?.name ?? "Custom"}
            </Badge>
          )}
          {!activePresetId && (
            <Badge variant="secondary" className="text-xs">Custom</Badge>
          )}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {presets.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <Card
                key={preset.id}
                className={`min-w-[200px] max-w-[220px] p-4 cursor-pointer transition-all hover:border-primary/50 flex-shrink-0 ${
                  isActive
                    ? "border-primary ring-1 ring-primary/40 bg-primary/5"
                    : "bg-card border-border"
                }`}
                onClick={() => !isActive && setConfirmPreset(preset)}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground leading-tight">
                      {preset.name}
                    </h3>
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={`text-[10px] px-1.5 py-0 ${RISK_COLORS[preset.riskLevel]}`}>
                      {preset.riskLevel}
                    </Badge>
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {preset.timeframe}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                    {preset.description}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <AlertDialog open={!!confirmPreset} onOpenChange={(open) => !open && setConfirmPreset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Apply "{confirmPreset?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will override all current strategy and risk settings with the preset
              configuration. Your current settings will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                if (confirmPreset) {
                  onApply(confirmPreset.id);
                  setConfirmPreset(null);
                }
              }}
            >
              {isPending ? "Applying..." : "Apply Preset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
