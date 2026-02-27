import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect } from "react";
import { defaultStrategyConfig } from "@/lib/mock-data";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";
import { Instrument, StrategyConfig } from "@/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const Strategy = () => {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<StrategyConfig>(defaultStrategyConfig);

  const { data: remoteConfig } = useQuery({
    queryKey: ["strategy"],
    queryFn: () => api.strategy(),
  });

  const { data: instruments = [] } = useQuery({
    queryKey: ["instruments"],
    queryFn: () => api.instruments(),
    staleTime: Infinity,
  });

  const activeInstrument: Instrument | undefined = instruments.find(
    (i) => i.symbol === config.symbol,
  );

  // Populate form once remote config loads
  useEffect(() => {
    if (remoteConfig) setConfig(remoteConfig);
  }, [remoteConfig]);

  const saveMutation = useMutation({
    mutationFn: (cfg: StrategyConfig) => api.updateStrategy(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
      toast.success("Strategy settings saved");
    },
    onError: (err: Error) => toast.error("Save failed", { description: err.message }),
  });

  const update = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => saveMutation.mutate(config);
  const handleReset = () => {
    setConfig(remoteConfig ?? defaultStrategyConfig);
    toast.info("Settings reset to last saved values");
  };

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Strategy Configuration</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleReset} className="gap-2">
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
            <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <Card className="p-6 bg-card border-border space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Market</h2>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="space-y-2 flex-1">
            <Label className="text-muted-foreground text-xs">Instrument</Label>
            <Select value={config.symbol} onValueChange={(v) => update("symbol", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select market…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground">Metals</SelectLabel>
                  {instruments
                    .filter((i) => i.category === "metals")
                    .map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>{i.label}</SelectItem>
                    ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground">Forex</SelectLabel>
                  {instruments
                    .filter((i) => i.category === "forex")
                    .map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>{i.label}</SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {activeInstrument && (
            <div className="flex gap-4 text-xs text-muted-foreground pb-2">
              <span>Pip size: <span className="font-mono text-foreground">{activeInstrument.pipSize}</span></span>
              <span>Min size: <span className="font-mono text-foreground">{activeInstrument.minPositionSize} units</span></span>
            </div>
          )}
        </div>
        {config.symbol !== (remoteConfig?.symbol ?? "XAU_USD") && (
          <p className="text-xs text-amber-500">
            Changing the market will restart market data when saved.
          </p>
        )}
      </Card>

      <Card className="p-6 bg-card border-border space-y-6">
        <h2 className="text-sm font-semibold text-foreground">Technical Indicators</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">EMA Fast Period: {config.emaFast}</Label>
            <Slider value={[config.emaFast]} onValueChange={([v]) => update("emaFast", v)} min={3} max={50} step={1} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">EMA Slow Period: {config.emaSlow}</Label>
            <Slider value={[config.emaSlow]} onValueChange={([v]) => update("emaSlow", v)} min={10} max={100} step={1} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">RSI Period</Label>
            <Input type="number" value={config.rsiPeriod} onChange={(e) => update("rsiPeriod", +e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">RSI Overbought: {config.rsiOverbought}</Label>
            <Slider value={[config.rsiOverbought]} onValueChange={([v]) => update("rsiOverbought", v)} min={60} max={90} step={1} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">RSI Oversold: {config.rsiOversold}</Label>
            <Slider value={[config.rsiOversold]} onValueChange={([v]) => update("rsiOversold", v)} min={10} max={40} step={1} />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card border-border space-y-6">
        <h2 className="text-sm font-semibold text-foreground">Entry / Exit Rules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Take Profit (pips)</Label>
            <Input type="number" value={config.takeProfit} onChange={(e) => update("takeProfit", +e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Stop Loss (pips)</Label>
            <Input type="number" value={config.stopLoss} onChange={(e) => update("stopLoss", +e.target.value)} className="font-mono" />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={config.trailingStop} onCheckedChange={(v) => update("trailingStop", v)} />
            <Label className="text-muted-foreground text-xs">Trailing Stop</Label>
            {config.trailingStop && (
              <Input type="number" value={config.trailingStopPips} onChange={(e) => update("trailingStopPips", +e.target.value)} className="font-mono w-20" placeholder="pips" />
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card border-border space-y-6">
        <h2 className="text-sm font-semibold text-foreground">Risk Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Risk Per Trade: {config.riskPerTrade}%</Label>
            <Slider value={[config.riskPerTrade]} onValueChange={([v]) => update("riskPerTrade", v)} min={0.5} max={2} step={0.1} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Max Open Positions</Label>
            <Input type="number" value={config.maxPositions} onChange={(e) => update("maxPositions", +e.target.value)} min={1} max={5} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Daily Loss Limit: {config.dailyLossLimit}%</Label>
            <Slider value={[config.dailyLossLimit]} onValueChange={([v]) => update("dailyLossLimit", v)} min={1} max={5} step={0.5} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Position Sizing</Label>
            <Select value={config.positionSizing} onValueChange={(v) => update("positionSizing", v as StrategyConfig["positionSizing"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="kelly">Kelly Criterion</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card border-border space-y-6">
        <h2 className="text-sm font-semibold text-foreground">Trading Schedule</h2>
        <div className="space-y-4">
          <div>
            <Label className="text-muted-foreground text-xs mb-2 block">Active Days</Label>
            <div className="flex gap-3">
              {days.map((day) => (
                <label key={day} className="flex items-center gap-1.5 text-sm text-foreground">
                  <Checkbox
                    checked={config.tradingDays.includes(day)}
                    onCheckedChange={(checked) => {
                      update(
                        "tradingDays",
                        checked
                          ? [...config.tradingDays, day]
                          : config.tradingDays.filter((d) => d !== day),
                      );
                    }}
                  />
                  {day}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Start Time</Label>
              <Input type="time" value={config.tradingHoursStart} onChange={(e) => update("tradingHoursStart", e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">End Time</Label>
              <Input type="time" value={config.tradingHoursEnd} onChange={(e) => update("tradingHoursEnd", e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Timezone</Label>
              <Select value={config.timezone} onValueChange={(v) => update("timezone", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="EST">EST</SelectItem>
                  <SelectItem value="GMT">GMT</SelectItem>
                  <SelectItem value="CET">CET</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Strategy;
