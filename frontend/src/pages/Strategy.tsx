import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { defaultStrategyConfig } from "@/lib/mock-data";
import { toast } from "sonner";
import { Save, RotateCcw, Shield, TrendingUp, Activity, Clock, BarChart3, Crosshair, Settings2, Zap, Grid3X3, Newspaper, Shuffle, Dice5, ArrowUpDown, Hash, Binary, Repeat, Layers, Rocket, Target, Flame, GitBranch, AlertTriangle } from "lucide-react";
import type { Instrument, StrategyConfig, StrategyType } from "@/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PresetCards } from "@/components/strategy/PresetCards";

// ── Strategy type metadata ────────────────────────────────────────────────────

const STRATEGY_META: Record<StrategyType, { label: string; description: string; icon: typeof TrendingUp; risk: string; riskColor: string }> = {
  CONSERVATIVE: {
    label: "Conservative EMA Scalp",
    description: "Strict EMA(9/21) crossover with 6 confirmation filters. Low frequency, high precision.",
    icon: Shield,
    risk: "LOW",
    riskColor: "text-emerald-400",
  },
  AGGRESSIVE_SCALPING: {
    label: "Aggressive Scalping",
    description: "Fast EMAs(5/13), loosened filters, breakeven moves, trailing stops. Higher frequency.",
    icon: Zap,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  LONDON_BREAKOUT: {
    label: "London Breakout",
    description: "Trades the London session open breakout from the Asian session range.",
    icon: TrendingUp,
    risk: "MEDIUM",
    riskColor: "text-yellow-400",
  },
  MEAN_REVERSION: {
    label: "Mean Reversion",
    description: "Bollinger Band + RSI bounce trading at band extremes. Targets mean (SMA) reversion.",
    icon: Activity,
    risk: "MEDIUM",
    riskColor: "text-yellow-400",
  },
  GRID_TRADING: {
    label: "Grid Trading",
    description: "Multi-level orders at price intervals. Works with any broker in virtual mode.",
    icon: Grid3X3,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  NEWS_EVENT: {
    label: "News Event",
    description: "Impulse trading around high-impact economic releases (NFP, CPI, FOMC).",
    icon: Newspaper,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  HYBRID: {
    label: "Hybrid (Time-Switched)",
    description: "London Breakout in the morning, Aggressive Scalping rest of day.",
    icon: Shuffle,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  COIN_FLIP: {
    label: "Coin Flip (Accumulator)",
    description: "Stake compounds each tick price stays in range. 5% growth = ~$11 from $1 in 50 ticks.",
    icon: Dice5,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  RISE_FALL: {
    label: "Rise/Fall",
    description: "Binary option — signal-driven or manual. Use EMA/RSI indicators to pick Rise vs Fall for an edge above 51.3%.",
    icon: ArrowUpDown,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  EVEN_ODD: {
    label: "Even/Odd",
    description: "Digit option — predict if last price digit is even or odd. True 50/50, ~95% payout.",
    icon: Hash,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  DIGIT_OVER_UNDER: {
    label: "Digit Over/Under",
    description: "Digit option — predict if last digit is over/under a barrier. Adjustable probability vs payout.",
    icon: Binary,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  MARTINGALE: {
    label: "Martingale Recovery",
    description: "Rise/Fall with doubling stakes after each loss. One win recovers all losses. High blow-up risk.",
    icon: Repeat,
    risk: "EXTREME",
    riskColor: "text-red-400",
  },
  ACCUMULATOR_LADDER: {
    label: "Accumulator Ladder",
    description: "Lower growth rate ACCU for wider barriers. Duration-based exits instead of fixed TP.",
    icon: Layers,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  MOMENTUM_RISE_FALL: {
    label: "Momentum Rise/Fall",
    description: "EMA-filtered rapid-fire Rise/Fall. Spam contracts in trend direction until signal flips.",
    icon: Rocket,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  DIGIT_SNIPER: {
    label: "Digit Sniper",
    description: "DIGITMATCH on multiple digits. 10:1 payout per digit, multi-coverage for higher hit rate.",
    icon: Target,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  VOLATILITY_BREAKOUT: {
    label: "Volatility Breakout",
    description: "Turbos on Crash/Boom indices. Buy after consecutive bleed ticks, betting on the spike.",
    icon: Flame,
    risk: "EXTREME",
    riskColor: "text-red-400",
  },
  HEDGED_ACCUMULATOR: {
    label: "Hedged Accumulator",
    description: "Two opposing ACCU contracts. One compounds while the other gets knocked out.",
    icon: GitBranch,
    risk: "HIGH",
    riskColor: "text-orange-400",
  },
  ALL_IN_RECOVERY: {
    label: "All-In Recovery",
    description: "Aggressive recovery mode. Larger stakes when balance drops below threshold. Demo only.",
    icon: AlertTriangle,
    risk: "EXTREME",
    riskColor: "text-red-400",
  },
};

const ALL_STRATEGY_TYPES: StrategyType[] = [
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

// ── Helper: number input ──────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        min={min}
        max={max}
        step={step}
        className="font-mono"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (remoteConfig) {
      // Merge with defaults so new config sections added after deploy don't crash the UI
      setConfig({
        ...defaultStrategyConfig,
        ...remoteConfig,
        aggressive: { ...defaultStrategyConfig.aggressive, ...remoteConfig.aggressive },
        londonBreakout: { ...defaultStrategyConfig.londonBreakout, ...remoteConfig.londonBreakout },
        meanReversion: { ...defaultStrategyConfig.meanReversion, ...remoteConfig.meanReversion },
        gridTrading: { ...defaultStrategyConfig.gridTrading, ...remoteConfig.gridTrading },
        newsEvent: { ...defaultStrategyConfig.newsEvent, ...remoteConfig.newsEvent },
        hybrid: { ...defaultStrategyConfig.hybrid, ...remoteConfig.hybrid },
        coinFlip: { ...defaultStrategyConfig.coinFlip, ...remoteConfig.coinFlip },
        riseFall: { ...defaultStrategyConfig.riseFall, ...remoteConfig.riseFall },
        evenOdd: { ...defaultStrategyConfig.evenOdd, ...remoteConfig.evenOdd },
        digitOverUnder: { ...defaultStrategyConfig.digitOverUnder, ...remoteConfig.digitOverUnder },
        martingale: { ...defaultStrategyConfig.martingale, ...remoteConfig.martingale },
        accumulatorLadder: { ...defaultStrategyConfig.accumulatorLadder, ...remoteConfig.accumulatorLadder },
        momentumRiseFall: { ...defaultStrategyConfig.momentumRiseFall, ...remoteConfig.momentumRiseFall },
        digitSniper: { ...defaultStrategyConfig.digitSniper, ...remoteConfig.digitSniper },
        volatilityBreakout: { ...defaultStrategyConfig.volatilityBreakout, ...remoteConfig.volatilityBreakout },
        hedgedAccumulator: { ...defaultStrategyConfig.hedgedAccumulator, ...remoteConfig.hedgedAccumulator },
        allInRecovery: { ...defaultStrategyConfig.allInRecovery, ...remoteConfig.allInRecovery },
      });
    }
  }, [remoteConfig]);

  const saveMutation = useMutation({
    mutationFn: (cfg: StrategyConfig) => api.updateStrategy(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
      toast.success("Strategy settings saved");
    },
    onError: (err: Error) => toast.error("Save failed", { description: err.message }),
  });

  const presetMutation = useMutation({
    mutationFn: (id: string) => api.applyPreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
      toast.success("Preset applied");
    },
    onError: (err: Error) => toast.error("Failed to apply preset", { description: err.message }),
  });

  const update = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateNested = <
    S extends "aggressive" | "londonBreakout" | "meanReversion" | "gridTrading" | "newsEvent" | "hybrid" | "coinFlip" | "riseFall" | "evenOdd" | "digitOverUnder" | "martingale" | "accumulatorLadder" | "momentumRiseFall" | "digitSniper" | "volatilityBreakout" | "hedgedAccumulator" | "allInRecovery",
    K extends keyof StrategyConfig[S],
  >(
    section: S,
    key: K,
    value: StrategyConfig[S][K],
  ) => {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const handleSave = () => saveMutation.mutate(config);
  const handleReset = () => {
    setConfig(remoteConfig ?? defaultStrategyConfig);
    toast.info("Settings reset to last saved values");
  };

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const st = config.strategyType;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="md:text-xl font-bold text-foreground">Strategy Configuration</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleReset} className="gap-2">
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
            <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* ── Presets ───────────────────────────────────────────────────────────── */}
      {/* <PresetCards
        activePresetId={config.activePreset}
        onApply={(id) => presetMutation.mutate(id)}
        isPending={presetMutation.isPending}
      /> */}

      {/* ── Strategy Type Selector ────────────────────────────────────────────── */}
      <Card className="p-6 bg-card border-border space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Strategy Type</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ALL_STRATEGY_TYPES.map((type) => {
            const meta = STRATEGY_META[type];
            const Icon = meta.icon;
            const isActive = config.strategyType === type;
            return (
              <button
                key={type}
                onClick={() => update("strategyType", type)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  isActive
                    ? "border-primary ring-1 ring-primary/40 bg-primary/5"
                    : "border-border bg-card hover:border-primary/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-xs font-medium text-foreground">{meta.label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  {meta.description}
                </p>
                <Badge variant="outline" className={`text-[10px] ${meta.riskColor}`}>
                  {meta.risk} RISK
                </Badge>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Market & Broker ───────────────────────────────────────────────────── */}
      <Card className="p-6 bg-card border-border space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Market & Broker</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Instrument</Label>
            <Select value={config.symbol} onValueChange={(v) => update("symbol", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select market..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground">Synthetic Indices</SelectLabel>
                  {instruments
                    .filter((i) => i.category === "synthetic")
                    .map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>{i.label}</SelectItem>
                    ))}
                </SelectGroup>
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
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground">Crypto</SelectLabel>
                  {instruments
                    .filter((i) => i.category === "crypto")
                    .map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>{i.label}</SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Broker</Label>
            <Select value={config.broker} onValueChange={(v) => update("broker", v as "deriv" | "mt5")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deriv">Deriv (Multipliers)</SelectItem>
                <SelectItem value="mt5">MetaTrader 5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {activeInstrument && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Pip size: <span className="font-mono text-foreground">{activeInstrument.pipSize}</span></span>
            <span>Min size: <span className="font-mono text-foreground">{activeInstrument.minPositionSize} units</span></span>
          </div>
        )}
        {config.symbol !== (remoteConfig?.symbol ?? "XAU_USD") && (
          <p className="text-xs text-amber-500">
            Changing the market will restart market data when saved.
          </p>
        )}
        {config.broker !== (remoteConfig?.broker ?? "deriv") && (
          <p className="text-xs text-amber-500">
            Switching broker will disconnect and reconnect when saved.
          </p>
        )}
      </Card>

      {/* ── Accordion sections ────────────────────────────────────────────────── */}
      <Accordion type="multiple" defaultValue={["indicators", "exits", "risk"]} className="space-y-3">

        {/* ── Technical Indicators ──────────────────────────────────────────── */}
        <AccordionItem value="indicators" className="border rounded-lg bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Technical Indicators</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 space-y-6">
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

            <Separator />

            {/* Trend Confirmation */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Trend Confirmation</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <NumberField label="EMA Trend Period" value={config.emaTrendPeriod} onChange={(v) => update("emaTrendPeriod", v)} min={10} max={200} hint="Higher-timeframe trend EMA" />
                <NumberField label="ADX Period" value={config.adxPeriod} onChange={(v) => update("adxPeriod", v)} min={5} max={50} />
                <NumberField label="ADX Threshold" value={config.adxThreshold} onChange={(v) => update("adxThreshold", v)} min={10} max={50} hint="Min ADX to allow trade" />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Entry / Exit Rules ────────────────────────────────────────────── */}
        <AccordionItem value="exits" className="border rounded-lg bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Entry & Exit Rules</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 space-y-6">
            {/* ATR Dynamic Stops */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={config.useAtrStops} onCheckedChange={(v) => update("useAtrStops", v)} />
                <Label className="text-xs font-semibold text-foreground">Use ATR-Based Dynamic Stops</Label>
              </div>
              {config.useAtrStops ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pl-1">
                  <NumberField label="ATR Period" value={config.atrPeriod} onChange={(v) => update("atrPeriod", v)} min={5} max={50} />
                  <NumberField label="ATR SL Multiplier" value={config.atrSlMultiplier} onChange={(v) => update("atrSlMultiplier", v)} min={0.5} max={5} step={0.1} hint="SL = ATR x this" />
                  <NumberField label="ATR TP Multiplier" value={config.atrTpMultiplier} onChange={(v) => update("atrTpMultiplier", v)} min={0.5} max={10} step={0.1} hint="TP = ATR x this" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-1">
                  <NumberField label="Take Profit (pips)" value={config.takeProfit} onChange={(v) => update("takeProfit", v)} min={1} />
                  <NumberField label="Stop Loss (pips)" value={config.stopLoss} onChange={(v) => update("stopLoss", v)} min={1} />
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                {config.useAtrStops
                  ? "Stop loss and take profit are calculated dynamically from ATR. Fixed pip values are used as fallback."
                  : "Using fixed pip values. Enable ATR stops for volatility-adaptive exits."}
              </p>
            </div>

            <Separator />

            {/* Fixed pip fallbacks (always visible) */}
            {config.useAtrStops && (
              <>
                <div>
                  <h3 className="text-xs font-semibold text-foreground mb-3">Fixed Pip Fallback</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <NumberField label="Take Profit (pips)" value={config.takeProfit} onChange={(v) => update("takeProfit", v)} min={1} hint="Used when ATR data unavailable" />
                    <NumberField label="Stop Loss (pips)" value={config.stopLoss} onChange={(v) => update("stopLoss", v)} min={1} hint="Used when ATR data unavailable" />
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Trailing Stop */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={config.trailingStop} onCheckedChange={(v) => update("trailingStop", v)} />
                <Label className="text-xs font-semibold text-foreground">Trailing Stop</Label>
              </div>
              {config.trailingStop && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-1">
                  <NumberField label="Trailing Stop Distance (pips)" value={config.trailingStopPips} onChange={(v) => update("trailingStopPips", v)} min={1} />
                  <NumberField label="Activation (pips in profit)" value={config.trailingActivationPips} onChange={(v) => update("trailingActivationPips", v)} min={1} hint="Pips profit before trailing starts" />
                  <div className="flex items-center gap-3 col-span-full">
                    <Switch checked={config.useAtrTrailing} onCheckedChange={(v) => update("useAtrTrailing", v)} />
                    <Label className="text-muted-foreground text-xs">Use ATR for trail distance</Label>
                    {config.useAtrTrailing && (
                      <Input
                        type="number"
                        value={config.trailingAtrMultiplier}
                        onChange={(e) => update("trailingAtrMultiplier", +e.target.value)}
                        className="font-mono w-24"
                        step={0.1}
                        min={0.1}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Breakeven */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={config.breakevenEnabled} onCheckedChange={(v) => update("breakevenEnabled", v)} />
                <Label className="text-xs font-semibold text-foreground">Move SL to Breakeven</Label>
              </div>
              {config.breakevenEnabled && (
                <div className="pl-1">
                  <NumberField label="Trigger (pips in profit)" value={config.breakevenTriggerPips} onChange={(v) => update("breakevenTriggerPips", v)} min={1} hint="Move SL to entry after this much profit" />
                </div>
              )}
            </div>

            <Separator />

            {/* Entry Quality Filters */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Entry Quality Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Min Candle Body (pips)" value={config.minBodyPips} onChange={(v) => update("minBodyPips", v)} min={0} hint="0 = disabled. Filters doji bars." />
                <NumberField label="Max Spread (pips)" value={config.spreadFilterPips} onChange={(v) => update("spreadFilterPips", v)} min={0} step={0.1} hint="Skip trade if spread exceeds this" />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Risk Management ──────────────────────────────────────────────── */}
        <AccordionItem value="risk" className="border rounded-lg bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Risk Management</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Risk Per Trade: {config.riskPerTrade}%</Label>
                <Slider value={[config.riskPerTrade]} onValueChange={([v]) => update("riskPerTrade", v)} min={0.1} max={10} step={0.1} />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Max Open Positions</Label>
                <Input type="number" value={config.maxPositions} onChange={(e) => update("maxPositions", +e.target.value)} min={1} max={10} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Daily Loss Limit: {config.dailyLossLimit}%</Label>
                <Slider value={[config.dailyLossLimit]} onValueChange={([v]) => update("dailyLossLimit", v)} min={1} max={10} step={0.5} />
                <p className="text-[10px] text-muted-foreground">Circuit breaker trips at this % of peak equity</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Max Drawdown: {config.maxDrawdown}%</Label>
                <Slider value={[config.maxDrawdown]} onValueChange={([v]) => update("maxDrawdown", v)} min={5} max={30} step={1} />
                <p className="text-[10px] text-muted-foreground">Permanent circuit breaker until manual reset</p>
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
          </AccordionContent>
        </AccordionItem>

        {/* ── Session & Schedule ────────────────────────────────────────────── */}
        <AccordionItem value="schedule" className="border rounded-lg bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Session & Schedule</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 space-y-6">
            {/* Trading days */}
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

            {/* Hours & timezone */}
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

            <Separator />

            {/* Session filter */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={config.sessionFilterEnabled} onCheckedChange={(v) => update("sessionFilterEnabled", v)} />
                <Label className="text-xs font-semibold text-foreground">Block Low-Liquidity Hours</Label>
              </div>
              {config.sessionFilterEnabled && (
                <div className="space-y-2 pl-1">
                  <Label className="text-muted-foreground text-xs">Blocked UTC Ranges (comma-separated)</Label>
                  <Input
                    value={config.blockedHoursUtc.join(",")}
                    onChange={(e) => update("blockedHoursUtc", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                    className="font-mono"
                    placeholder="22:00-01:00,16:00-17:00"
                  />
                  <p className="text-[10px] text-muted-foreground">Format: HH:MM-HH:MM. Ranges crossing midnight (e.g. 22:00-01:00) are handled correctly.</p>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Strategy-Specific Config ─────────────────────────────────────── */}
        {st === "AGGRESSIVE_SCALPING" && (
          <AccordionItem value="aggressive" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Aggressive Scalping Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Fast EMA" value={config.aggressive.emaFast} onChange={(v) => updateNested("aggressive", "emaFast", v)} min={2} max={20} />
                <NumberField label="Slow EMA" value={config.aggressive.emaSlow} onChange={(v) => updateNested("aggressive", "emaSlow", v)} min={5} max={50} />
                <NumberField label="RSI Overbought" value={config.aggressive.rsiOverbought} onChange={(v) => updateNested("aggressive", "rsiOverbought", v)} min={60} max={95} />
                <NumberField label="RSI Oversold" value={config.aggressive.rsiOversold} onChange={(v) => updateNested("aggressive", "rsiOversold", v)} min={5} max={40} />
                <NumberField label="ADX Threshold" value={config.aggressive.adxThreshold} onChange={(v) => updateNested("aggressive", "adxThreshold", v)} min={5} max={50} />
                <NumberField label="Breakeven After (pips)" value={config.aggressive.breakevenAfterPips} onChange={(v) => updateNested("aggressive", "breakevenAfterPips", v)} min={1} hint="Move SL to entry" />
                <NumberField label="Trailing Activation (pips)" value={config.aggressive.trailingActivationPips} onChange={(v) => updateNested("aggressive", "trailingActivationPips", v)} min={1} />
                <div className="flex items-center gap-3">
                  <Switch checked={config.aggressive.useTrendFilter} onCheckedChange={(v) => updateNested("aggressive", "useTrendFilter", v)} />
                  <Label className="text-muted-foreground text-xs">EMA(50) Trend Filter</Label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "LONDON_BREAKOUT" && (
          <AccordionItem value="london" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold">London Breakout Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Asian Range Start (UTC Hour)" value={config.londonBreakout.asianRangeStartHour} onChange={(v) => updateNested("londonBreakout", "asianRangeStartHour", v)} min={0} max={23} />
                <NumberField label="Asian Range End (UTC Hour)" value={config.londonBreakout.asianRangeEndHour} onChange={(v) => updateNested("londonBreakout", "asianRangeEndHour", v)} min={0} max={23} />
                <NumberField label="Breakout Window End (UTC Hour)" value={config.londonBreakout.breakoutWindowEndHour} onChange={(v) => updateNested("londonBreakout", "breakoutWindowEndHour", v)} min={0} max={23} />
                <NumberField label="Min Range (pips)" value={config.londonBreakout.minRangePips} onChange={(v) => updateNested("londonBreakout", "minRangePips", v)} min={1} hint="Skip if range too narrow" />
                <NumberField label="Max Range (pips)" value={config.londonBreakout.maxRangePips} onChange={(v) => updateNested("londonBreakout", "maxRangePips", v)} min={5} hint="Skip if range too wide" />
                <NumberField label="SL Range Multiplier" value={config.londonBreakout.slRangeMultiplier} onChange={(v) => updateNested("londonBreakout", "slRangeMultiplier", v)} min={0.1} max={3} step={0.1} hint="SL = range x this" />
                <NumberField label="TP Range Multiplier" value={config.londonBreakout.tpRangeMultiplier} onChange={(v) => updateNested("londonBreakout", "tpRangeMultiplier", v)} min={0.5} max={5} step={0.1} hint="TP = range x this" />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "MEAN_REVERSION" && (
          <AccordionItem value="meanrev" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold">Mean Reversion Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Bollinger Period" value={config.meanReversion.bollingerPeriod} onChange={(v) => updateNested("meanReversion", "bollingerPeriod", v)} min={5} max={50} />
                <NumberField label="Bollinger Std Dev" value={config.meanReversion.bollingerStdDev} onChange={(v) => updateNested("meanReversion", "bollingerStdDev", v)} min={0.5} max={4} step={0.1} />
                <NumberField label="RSI Oversold" value={config.meanReversion.rsiOversold} onChange={(v) => updateNested("meanReversion", "rsiOversold", v)} min={5} max={40} />
                <NumberField label="RSI Overbought" value={config.meanReversion.rsiOverbought} onChange={(v) => updateNested("meanReversion", "rsiOverbought", v)} min={60} max={95} />
                <NumberField label="ATR SL Multiplier" value={config.meanReversion.atrSlMultiplier} onChange={(v) => updateNested("meanReversion", "atrSlMultiplier", v)} min={0.5} max={5} step={0.1} />
                <NumberField label="ATR TP Multiplier" value={config.meanReversion.atrTpMultiplier} onChange={(v) => updateNested("meanReversion", "atrTpMultiplier", v)} min={0.5} max={5} step={0.1} />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "GRID_TRADING" && (
          <AccordionItem value="grid" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Grid3X3 className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Grid Trading Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Grid Levels" value={config.gridTrading.gridLevels} onChange={(v) => updateNested("gridTrading", "gridLevels", v)} min={2} max={20} hint="Levels above & below price" />
                <NumberField label="Grid Spacing" value={config.gridTrading.gridSpacing} onChange={(v) => updateNested("gridTrading", "gridSpacing", v)} min={0.1} step={0.1} hint="Distance between levels (instrument units)" />
                <NumberField label="Stake Per Level ($)" value={config.gridTrading.lotSizePerLevel} onChange={(v) => updateNested("gridTrading", "lotSizePerLevel", v)} min={0.5} step={0.5} />
                <NumberField label="TP Per Level" value={config.gridTrading.takeProfitPerLevel} onChange={(v) => updateNested("gridTrading", "takeProfitPerLevel", v)} min={0.1} step={0.1} hint="Same units as spacing" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Max Grid Drawdown: {(config.gridTrading.maxGridDrawdown * 100).toFixed(0)}%</Label>
                  <Slider value={[config.gridTrading.maxGridDrawdown * 100]} onValueChange={([v]) => updateNested("gridTrading", "maxGridDrawdown", v / 100)} min={1} max={20} step={1} />
                  <p className="text-[10px] text-muted-foreground">Shut down all grid orders at this drawdown</p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch checked={config.gridTrading.trendDetectionEnabled} onCheckedChange={(v) => updateNested("gridTrading", "trendDetectionEnabled", v)} />
                    <Label className="text-muted-foreground text-xs">ADX Trend Detection</Label>
                  </div>
                  {config.gridTrading.trendDetectionEnabled && (
                    <NumberField label="ADX Shutdown Threshold" value={config.gridTrading.trendAdxThreshold} onChange={(v) => updateNested("gridTrading", "trendAdxThreshold", v)} min={15} max={60} hint="Shut down grid if ADX exceeds this" />
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "NEWS_EVENT" && (
          <AccordionItem value="news" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">News Event Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Blackout Before (min)" value={config.newsEvent.blackoutMinutesBefore} onChange={(v) => updateNested("newsEvent", "blackoutMinutesBefore", v)} min={1} max={30} hint="Stop trading before event" />
                <NumberField label="Entry Window After (min)" value={config.newsEvent.entryWindowMinutesAfter} onChange={(v) => updateNested("newsEvent", "entryWindowMinutesAfter", v)} min={1} max={15} hint="Look for impulse entry" />
                <NumberField label="Min Impulse Body (pips)" value={config.newsEvent.minImpulseBodyPips} onChange={(v) => updateNested("newsEvent", "minImpulseBodyPips", v)} min={1} />
                <NumberField label="ATR SL Multiplier" value={config.newsEvent.atrSlMultiplier} onChange={(v) => updateNested("newsEvent", "atrSlMultiplier", v)} min={0.5} max={5} step={0.1} />
                <NumberField label="ATR TP Multiplier" value={config.newsEvent.atrTpMultiplier} onChange={(v) => updateNested("newsEvent", "atrTpMultiplier", v)} min={0.5} max={10} step={0.1} />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Scheduled Events (one per line)</Label>
                <textarea
                  value={config.newsEvent.scheduledEvents.join("\n")}
                  onChange={(e) => updateNested("newsEvent", "scheduledEvents", e.target.value.split("\n").filter(Boolean))}
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={"14:30\n2026-04-04T13:30:00Z"}
                />
                <p className="text-[10px] text-muted-foreground">HH:MM for daily recurring (UTC), or full ISO datetime for one-off events.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "HYBRID" && (
          <AccordionItem value="hybrid" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Shuffle className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Hybrid Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="London End Hour (UTC)" value={config.hybrid.londonEndHour} onChange={(v) => updateNested("hybrid", "londonEndHour", v)} min={0} max={23} hint="Switch to Aggressive Scalping" />
                <NumberField label="Scalping End Hour (UTC)" value={config.hybrid.scalpingEndHour} onChange={(v) => updateNested("hybrid", "scalpingEndHour", v)} min={0} max={23} hint="Stop all trading" />
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                00:00 - {config.hybrid.londonEndHour}:00 London Breakout | {config.hybrid.londonEndHour}:00 - {config.hybrid.scalpingEndHour}:00 Aggressive Scalping | {config.hybrid.scalpingEndHour}:00 - 24:00 Off
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "COIN_FLIP" && (
          <AccordionItem value="coinflip" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Dice5 className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Coin Flip (Accumulator) Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Growth Rate: {(config.coinFlip.growthRate * 100).toFixed(0)}%</Label>
                  <Slider value={[config.coinFlip.growthRate * 100]} onValueChange={([v]) => updateNested("coinFlip", "growthRate", v / 100)} min={1} max={5} step={1} />
                  <p className="text-[10px] text-muted-foreground">Higher = faster growth but tighter barrier (riskier)</p>
                </div>
                <NumberField label="Stake ($)" value={config.coinFlip.stake} onChange={(v) => updateNested("coinFlip", "stake", v)} min={0.35} max={50} step={0.1} hint="Amount per contract" />
                <NumberField label="Take Profit ($)" value={config.coinFlip.takeProfitUSD} onChange={(v) => updateNested("coinFlip", "takeProfitUSD", v)} min={0} step={0.5} hint="0 = ride until barrier hit" />
                <NumberField label="Max Contracts" value={config.coinFlip.maxContracts} onChange={(v) => updateNested("coinFlip", "maxContracts", v)} min={1} max={20} hint="Max concurrent accumulator contracts (parallel)" />
                <NumberField label="Cooldown (seconds)" value={config.coinFlip.cooldownSeconds} onChange={(v) => updateNested("coinFlip", "cooldownSeconds", v)} min={1} max={300} hint="Wait between opening new contracts" />
                <NumberField label="Min Balance ($)" value={config.coinFlip.minBalance} onChange={(v) => updateNested("coinFlip", "minBalance", v)} min={0} max={1000} step={0.5} hint="Stop trading when balance drops to this. 0 = no floor." />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Each tick the price stays within a barrier, your payout grows by {(config.coinFlip.growthRate * 100).toFixed(0)}% (compounding). If it breaches the barrier, you lose the ${config.coinFlip.stake} stake.</p>
                <p><strong>Example:</strong> $1 stake at 5% growth = ~$11.47 after 50 ticks (~50 seconds). Max 230 ticks, $10,000 payout cap.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "RISE_FALL" && (
          <AccordionItem value="risefall" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold">Rise/Fall Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake ($)" value={config.riseFall.stake} onChange={(v) => updateNested("riseFall", "stake", v)} min={0.35} max={100} step={0.1} hint="Amount per contract" />
                <NumberField label="Duration (ticks)" value={config.riseFall.durationTicks} onChange={(v) => updateNested("riseFall", "durationTicks", v)} min={1} max={10} hint="Contract duration in ticks (1-10)" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Direction Mode</Label>
                  <Select value={config.riseFall.direction} onValueChange={(v) => updateNested("riseFall", "direction", v as "rise" | "fall" | "auto" | "signal")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signal">Signal (EMA + RSI)</SelectItem>
                      <SelectItem value="auto">Auto (Random)</SelectItem>
                      <SelectItem value="rise">Always Rise (CALL)</SelectItem>
                      <SelectItem value="fall">Always Fall (PUT)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {config.riseFall.direction === "signal"
                      ? "Uses EMA crossover + RSI to choose Rise or Fall — even a 52% accuracy is profitable"
                      : config.riseFall.direction === "auto"
                        ? "Randomly picks rise or fall each trade (pure gambling, ~-5% EV)"
                        : `Always ${config.riseFall.direction === "rise" ? "Rise (CALL)" : "Fall (PUT)"}`}
                  </p>
                </div>
                <NumberField label="Max Contracts" value={config.riseFall.maxContracts} onChange={(v) => updateNested("riseFall", "maxContracts", v)} min={1} max={20} hint="Max concurrent contracts (parallel)" />
                <NumberField label="Cooldown (seconds)" value={config.riseFall.cooldownSeconds} onChange={(v) => updateNested("riseFall", "cooldownSeconds", v)} min={1} max={300} hint="Wait between contracts" />
                <NumberField label="Min Balance ($)" value={config.riseFall.minBalance} onChange={(v) => updateNested("riseFall", "minBalance", v)} min={0} max={1000} step={0.5} hint="Stop when balance drops to this" />
              </div>

              {config.riseFall.direction === "signal" && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-xs font-semibold text-foreground mb-3">Signal Indicators</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <NumberField label="EMA Fast Period" value={config.riseFall.signalEmaFast} onChange={(v) => updateNested("riseFall", "signalEmaFast", v)} min={2} max={50} hint="Short-term EMA for momentum" />
                      <NumberField label="EMA Slow Period" value={config.riseFall.signalEmaSlow} onChange={(v) => updateNested("riseFall", "signalEmaSlow", v)} min={5} max={100} hint="Long-term EMA for trend" />
                      <NumberField label="RSI Period" value={config.riseFall.signalRsiPeriod} onChange={(v) => updateNested("riseFall", "signalRsiPeriod", v)} min={5} max={50} />
                      <NumberField label="RSI Overbought" value={config.riseFall.signalRsiOverbought} onChange={(v) => updateNested("riseFall", "signalRsiOverbought", v)} min={60} max={90} hint="Above this = bias Fall" />
                      <NumberField label="RSI Oversold" value={config.riseFall.signalRsiOversold} onChange={(v) => updateNested("riseFall", "signalRsiOversold", v)} min={10} max={40} hint="Below this = bias Rise" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                      <Switch checked={config.riseFall.requireConfluence} onCheckedChange={(v) => updateNested("riseFall", "requireConfluence", v)} />
                      <div>
                        <Label className="text-muted-foreground text-xs">Require Confluence</Label>
                        <p className="text-[10px] text-muted-foreground">Both EMA direction + RSI must agree to trade</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={config.riseFall.skipOnNoSignal} onCheckedChange={(v) => updateNested("riseFall", "skipOnNoSignal", v)} />
                      <div>
                        <Label className="text-muted-foreground text-xs">Skip on No Signal</Label>
                        <p className="text-[10px] text-muted-foreground">When off, falls back to random if no clear signal</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Predict if price will be higher (Rise) or lower (Fall) after {config.riseFall.durationTicks} ticks. ~95% payout on win, lose stake on loss.</p>
                {config.riseFall.direction === "signal" ? (
                  <p><strong>Signal mode:</strong> EMA({config.riseFall.signalEmaFast}/{config.riseFall.signalEmaSlow}) crossover determines direction. RSI({config.riseFall.signalRsiPeriod}) confirms or overrides. Even 52% accuracy = +$0.024/trade at $1 stake.</p>
                ) : (
                  <p><strong>Edge:</strong> 50% base probability, need &gt;51.3% win rate to profit. Switch to Signal mode for indicator-driven direction.</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "EVEN_ODD" && (
          <AccordionItem value="evenodd" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold">Even/Odd Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake ($)" value={config.evenOdd.stake} onChange={(v) => updateNested("evenOdd", "stake", v)} min={0.35} max={100} step={0.1} hint="Amount per contract" />
                <NumberField label="Duration (ticks)" value={config.evenOdd.durationTicks} onChange={(v) => updateNested("evenOdd", "durationTicks", v)} min={1} max={10} hint="Contract duration in ticks (1-10)" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Prediction</Label>
                  <Select value={config.evenOdd.prediction} onValueChange={(v) => updateNested("evenOdd", "prediction", v as "even" | "odd" | "auto")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Random)</SelectItem>
                      <SelectItem value="even">Even (0,2,4,6,8)</SelectItem>
                      <SelectItem value="odd">Odd (1,3,5,7,9)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Auto = randomly pick even or odd each trade</p>
                </div>
                <NumberField label="Max Contracts" value={config.evenOdd.maxContracts} onChange={(v) => updateNested("evenOdd", "maxContracts", v)} min={1} max={20} hint="Max concurrent contracts (parallel)" />
                <NumberField label="Cooldown (seconds)" value={config.evenOdd.cooldownSeconds} onChange={(v) => updateNested("evenOdd", "cooldownSeconds", v)} min={1} max={300} hint="Wait between contracts" />
                <NumberField label="Min Balance ($)" value={config.evenOdd.minBalance} onChange={(v) => updateNested("evenOdd", "minBalance", v)} min={0} max={1000} step={0.5} hint="Stop when balance drops to this" />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Predict if the last digit of the price after {config.evenOdd.durationTicks} ticks is even or odd. ~95% payout, exactly 50/50 probability.</p>
                <p><strong>Warning:</strong> Purely random — no technical analysis can improve the win rate. House edge of ~5%.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {st === "DIGIT_OVER_UNDER" && (
          <AccordionItem value="digitoverunder" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Binary className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold">Digit Over/Under Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake ($)" value={config.digitOverUnder.stake} onChange={(v) => updateNested("digitOverUnder", "stake", v)} min={0.35} max={100} step={0.1} hint="Amount per contract" />
                <NumberField label="Duration (ticks)" value={config.digitOverUnder.durationTicks} onChange={(v) => updateNested("digitOverUnder", "durationTicks", v)} min={1} max={10} hint="Contract duration in ticks (1-10)" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Direction</Label>
                  <Select value={config.digitOverUnder.direction} onValueChange={(v) => updateNested("digitOverUnder", "direction", v as "over" | "under")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="over">Over (digit &gt; barrier)</SelectItem>
                      <SelectItem value="under">Under (digit &lt; barrier)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Barrier Digit" value={config.digitOverUnder.barrier} onChange={(v) => updateNested("digitOverUnder", "barrier", v)} min={0} max={9} hint="Last digit barrier (0-9)" />
                <NumberField label="Max Contracts" value={config.digitOverUnder.maxContracts} onChange={(v) => updateNested("digitOverUnder", "maxContracts", v)} min={1} max={20} hint="Max concurrent contracts (parallel)" />
                <NumberField label="Cooldown (seconds)" value={config.digitOverUnder.cooldownSeconds} onChange={(v) => updateNested("digitOverUnder", "cooldownSeconds", v)} min={1} max={300} hint="Wait between contracts" />
                <NumberField label="Min Balance ($)" value={config.digitOverUnder.minBalance} onChange={(v) => updateNested("digitOverUnder", "minBalance", v)} min={0} max={1000} step={0.5} hint="Stop when balance drops to this" />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Predict if the last digit is {config.digitOverUnder.direction} {config.digitOverUnder.barrier} after {config.digitOverUnder.durationTicks} ticks.</p>
                <p><strong>Probability:</strong> Barrier 4 + Over = 50% win / ~95% payout. Barrier 0 + Over = 90% win / ~10% payout (like accumulator). Barrier 8 + Over = 10% win / ~900% payout (lottery).</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Martingale Recovery ─────────────────────────────────────────── */}
        {st === "MARTINGALE" && (
          <AccordionItem value="martingale" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Repeat className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold">Martingale Recovery Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Base Stake ($)" value={config.martingale.baseStake} onChange={(v) => updateNested("martingale", "baseStake", v)} min={0.35} max={100} step={0.1} hint="First bet amount" />
                <NumberField label="Multiplier" value={config.martingale.multiplier} onChange={(v) => updateNested("martingale", "multiplier", v)} min={1.5} max={4} step={0.1} hint="2 = classic double. 1.5 = slower progression." />
                <NumberField label="Max Consecutive Losses" value={config.martingale.maxConsecutiveLosses} onChange={(v) => updateNested("martingale", "maxConsecutiveLosses", v)} min={2} max={10} hint="Safety limit — stop after N losses" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Contract Type</Label>
                  <Select value={config.martingale.contractType} onValueChange={(v) => updateNested("martingale", "contractType", v as "rise_fall" | "even_odd")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rise_fall">Rise/Fall (~50%, ~95% payout)</SelectItem>
                      <SelectItem value="even_odd">Even/Odd (50%, ~95% payout)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Duration (ticks)" value={config.martingale.durationTicks} onChange={(v) => updateNested("martingale", "durationTicks", v)} min={1} max={10} />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Direction Mode</Label>
                  <Select value={config.martingale.directionMode} onValueChange={(v) => updateNested("martingale", "directionMode", v as "auto" | "signal")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Random)</SelectItem>
                      <SelectItem value="signal">Signal (EMA filtered)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Cooldown (seconds)" value={config.martingale.cooldownSeconds} onChange={(v) => updateNested("martingale", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Min Balance ($)" value={config.martingale.minBalance} onChange={(v) => updateNested("martingale", "minBalance", v)} min={0} max={1000} step={0.5} />
                <NumberField label="Max Session Loss ($)" value={config.martingale.maxSessionLoss} onChange={(v) => updateNested("martingale", "maxSessionLoss", v)} min={1} max={1000} hint="Stop trading after this total loss" />
              </div>
              {config.martingale.directionMode === "signal" && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-xs font-semibold text-foreground mb-3">Signal Filter</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <NumberField label="EMA Fast" value={config.martingale.signalEmaFast} onChange={(v) => updateNested("martingale", "signalEmaFast", v)} min={2} max={50} />
                      <NumberField label="EMA Slow" value={config.martingale.signalEmaSlow} onChange={(v) => updateNested("martingale", "signalEmaSlow", v)} min={5} max={100} />
                    </div>
                  </div>
                </>
              )}
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Start at ${config.martingale.baseStake}. After each loss, multiply stake by {config.martingale.multiplier}x. One win recovers all previous losses + ${config.martingale.baseStake} profit. Then reset.</p>
                <p><strong>Max risk:</strong> {config.martingale.maxConsecutiveLosses} consecutive losses = ${Array.from({length: config.martingale.maxConsecutiveLosses}, (_, i) => config.martingale.baseStake * Math.pow(config.martingale.multiplier, i)).reduce((a, b) => a + b, 0).toFixed(2)} total loss. Probability: ~{(Math.pow(0.5, config.martingale.maxConsecutiveLosses) * 100).toFixed(1)}% per sequence.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Accumulator Ladder ──────────────────────────────────────────── */}
        {st === "ACCUMULATOR_LADDER" && (
          <AccordionItem value="acculadder" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Accumulator Ladder Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Growth Rate: {(config.accumulatorLadder.growthRate * 100).toFixed(0)}%</Label>
                  <Slider value={[config.accumulatorLadder.growthRate * 100]} onValueChange={([v]) => updateNested("accumulatorLadder", "growthRate", v / 100)} min={1} max={5} step={1} />
                  <p className="text-[10px] text-muted-foreground">Lower = wider barrier = longer survival, slower growth</p>
                </div>
                <NumberField label="Stake ($)" value={config.accumulatorLadder.stake} onChange={(v) => updateNested("accumulatorLadder", "stake", v)} min={0.35} max={100} step={0.1} />
                <NumberField label="Max Duration (seconds)" value={config.accumulatorLadder.maxDurationSeconds} onChange={(v) => updateNested("accumulatorLadder", "maxDurationSeconds", v)} min={0} max={300} hint="0 = ride until knocked out" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Target Profit: {(config.accumulatorLadder.targetProfitPercent * 100).toFixed(0)}% of stake</Label>
                  <Slider value={[config.accumulatorLadder.targetProfitPercent * 100]} onValueChange={([v]) => updateNested("accumulatorLadder", "targetProfitPercent", v / 100)} min={0} max={500} step={10} />
                  <p className="text-[10px] text-muted-foreground">0 = no profit target, ride until duration or knockout</p>
                </div>
                <NumberField label="Max Contracts" value={config.accumulatorLadder.maxContracts} onChange={(v) => updateNested("accumulatorLadder", "maxContracts", v)} min={1} max={10} />
                <NumberField label="Cooldown (seconds)" value={config.accumulatorLadder.cooldownSeconds} onChange={(v) => updateNested("accumulatorLadder", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Min Balance ($)" value={config.accumulatorLadder.minBalance} onChange={(v) => updateNested("accumulatorLadder", "minBalance", v)} min={0} max={1000} step={0.5} />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Open ACCU at {(config.accumulatorLadder.growthRate * 100).toFixed(0)}% growth. Lower growth = wider barrier = contracts survive longer. Close at {(config.accumulatorLadder.targetProfitPercent * 100).toFixed(0)}% profit or {config.accumulatorLadder.maxDurationSeconds}s.</p>
                <p><strong>Example:</strong> $5 stake at 1% growth, 50% target = close when payout hits $7.50. Much more achievable than 5% growth.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Momentum Rise/Fall ──────────────────────────────────────────── */}
        {st === "MOMENTUM_RISE_FALL" && (
          <AccordionItem value="momentumrf" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Momentum Rise/Fall Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake ($)" value={config.momentumRiseFall.stake} onChange={(v) => updateNested("momentumRiseFall", "stake", v)} min={0.35} max={100} step={0.1} />
                <NumberField label="Duration (ticks)" value={config.momentumRiseFall.durationTicks} onChange={(v) => updateNested("momentumRiseFall", "durationTicks", v)} min={1} max={10} />
                <NumberField label="EMA Fast" value={config.momentumRiseFall.emaFast} onChange={(v) => updateNested("momentumRiseFall", "emaFast", v)} min={2} max={20} hint="Short-term momentum" />
                <NumberField label="EMA Slow" value={config.momentumRiseFall.emaSlow} onChange={(v) => updateNested("momentumRiseFall", "emaSlow", v)} min={5} max={50} hint="Trend direction" />
                <NumberField label="Max Burst Contracts" value={config.momentumRiseFall.maxBurstContracts} onChange={(v) => updateNested("momentumRiseFall", "maxBurstContracts", v)} min={1} max={20} hint="Contracts per signal burst" />
                <NumberField label="Burst Interval (seconds)" value={config.momentumRiseFall.burstIntervalSeconds} onChange={(v) => updateNested("momentumRiseFall", "burstIntervalSeconds", v)} min={1} max={30} hint="Time between contracts in a burst" />
                <NumberField label="Cooldown (seconds)" value={config.momentumRiseFall.cooldownSeconds} onChange={(v) => updateNested("momentumRiseFall", "cooldownSeconds", v)} min={1} max={300} hint="Wait after burst before re-evaluating" />
                <NumberField label="Min Balance ($)" value={config.momentumRiseFall.minBalance} onChange={(v) => updateNested("momentumRiseFall", "minBalance", v)} min={0} max={1000} step={0.5} />
                <div className="flex items-center gap-3">
                  <Switch checked={config.momentumRiseFall.stopOnSignalFlip} onCheckedChange={(v) => updateNested("momentumRiseFall", "stopOnSignalFlip", v)} />
                  <div>
                    <Label className="text-muted-foreground text-xs">Stop on Signal Flip</Label>
                    <p className="text-[10px] text-muted-foreground">Abort burst if EMA direction reverses mid-burst</p>
                  </div>
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> EMA({config.momentumRiseFall.emaFast}) crosses above EMA({config.momentumRiseFall.emaSlow}) → fire {config.momentumRiseFall.maxBurstContracts} CALL contracts. Crosses below → fire PUT. Stop when flat.</p>
                <p><strong>Edge:</strong> Even 53% directional accuracy at 95% payout = ~$0.05/trade profit. At {config.momentumRiseFall.maxBurstContracts} trades/burst × ${config.momentumRiseFall.stake} = ${(config.momentumRiseFall.maxBurstContracts * config.momentumRiseFall.stake * 0.05).toFixed(2)}/burst expected.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Digit Sniper ────────────────────────────────────────────────── */}
        {st === "DIGIT_SNIPER" && (
          <AccordionItem value="digitsniper" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Digit Sniper Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake Per Digit ($)" value={config.digitSniper.stakePerDigit} onChange={(v) => updateNested("digitSniper", "stakePerDigit", v)} min={0.35} max={50} step={0.05} hint="Total cost = this × number of digits" />
                <NumberField label="Duration (ticks)" value={config.digitSniper.durationTicks} onChange={(v) => updateNested("digitSniper", "durationTicks", v)} min={1} max={10} />
                <div className="space-y-2 col-span-full">
                  <Label className="text-muted-foreground text-xs">Target Digits (comma-separated, 0-9)</Label>
                  <Input
                    value={config.digitSniper.targetDigits.join(",")}
                    onChange={(e) => updateNested("digitSniper", "targetDigits", e.target.value.split(",").map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 9))}
                    className="font-mono"
                    placeholder="3,5,7"
                  />
                  <p className="text-[10px] text-muted-foreground">{config.digitSniper.targetDigits.length} digits = {config.digitSniper.targetDigits.length * 10}% hit rate. Cost per round: ${(config.digitSniper.stakePerDigit * config.digitSniper.targetDigits.length).toFixed(2)}</p>
                </div>
                <NumberField label="Max Concurrent Rounds" value={config.digitSniper.maxConcurrentRounds} onChange={(v) => updateNested("digitSniper", "maxConcurrentRounds", v)} min={1} max={10} />
                <NumberField label="Cooldown (seconds)" value={config.digitSniper.cooldownSeconds} onChange={(v) => updateNested("digitSniper", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Min Balance ($)" value={config.digitSniper.minBalance} onChange={(v) => updateNested("digitSniper", "minBalance", v)} min={0} max={1000} step={0.5} />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> DIGITMATCH on digits [{config.digitSniper.targetDigits.join(", ")}] simultaneously. Each hit pays ~900% of its stake.</p>
                <p><strong>Math:</strong> {config.digitSniper.targetDigits.length} digits × ${config.digitSniper.stakePerDigit}/digit = ${(config.digitSniper.stakePerDigit * config.digitSniper.targetDigits.length).toFixed(2)}/round. Win pays ~${(config.digitSniper.stakePerDigit * 9).toFixed(2)}. Net EV still negative but fun for demo testing.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Volatility Breakout ─────────────────────────────────────────── */}
        {st === "VOLATILITY_BREAKOUT" && (
          <AccordionItem value="volbreakout" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold">Volatility Breakout Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Stake ($)" value={config.volatilityBreakout.stake} onChange={(v) => updateNested("volatilityBreakout", "stake", v)} min={0.35} max={100} step={0.1} />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Target Index</Label>
                  <Select value={config.volatilityBreakout.targetIndex} onValueChange={(v) => updateNested("volatilityBreakout", "targetIndex", v as "BOOM500" | "BOOM1000" | "CRASH500" | "CRASH1000")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOOM500">Boom 500 (spike up every ~500 ticks)</SelectItem>
                      <SelectItem value="BOOM1000">Boom 1000 (spike up every ~1000 ticks)</SelectItem>
                      <SelectItem value="CRASH500">Crash 500 (spike down every ~500 ticks)</SelectItem>
                      <SelectItem value="CRASH1000">Crash 1000 (spike down every ~1000 ticks)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Consecutive Tick Threshold" value={config.volatilityBreakout.consecutiveTickThreshold} onChange={(v) => updateNested("volatilityBreakout", "consecutiveTickThreshold", v)} min={3} max={50} hint="Buy after this many bleed-direction ticks" />
                <NumberField label="Turbo Duration (minutes)" value={config.volatilityBreakout.turboDurationMinutes} onChange={(v) => updateNested("volatilityBreakout", "turboDurationMinutes", v)} min={1} max={60} />
                <NumberField label="Max Contracts" value={config.volatilityBreakout.maxContracts} onChange={(v) => updateNested("volatilityBreakout", "maxContracts", v)} min={1} max={10} />
                <NumberField label="Cooldown (seconds)" value={config.volatilityBreakout.cooldownSeconds} onChange={(v) => updateNested("volatilityBreakout", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Min Balance ($)" value={config.volatilityBreakout.minBalance} onChange={(v) => updateNested("volatilityBreakout", "minBalance", v)} min={0} max={1000} step={0.5} />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> {config.volatilityBreakout.targetIndex.startsWith("BOOM") ? "Boom" : "Crash"} indices bleed slowly then spike sharply. After {config.volatilityBreakout.consecutiveTickThreshold} consecutive bleed ticks, buy a {config.volatilityBreakout.turboDurationMinutes}-minute Turbo betting on the spike.</p>
                <p><strong>Risk:</strong> You bleed money on every contract that expires without a spike. Essentially lottery-ticketing — but one good spike can return 3-5x stake.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── Hedged Accumulator ──────────────────────────────────────────── */}
        {st === "HEDGED_ACCUMULATOR" && (
          <AccordionItem value="hedgedaccu" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">Hedged Accumulator Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Growth Rate: {(config.hedgedAccumulator.growthRate * 100).toFixed(0)}%</Label>
                  <Slider value={[config.hedgedAccumulator.growthRate * 100]} onValueChange={([v]) => updateNested("hedgedAccumulator", "growthRate", v / 100)} min={1} max={5} step={1} />
                </div>
                <NumberField label="Stake Per Side ($)" value={config.hedgedAccumulator.stakePerSide} onChange={(v) => updateNested("hedgedAccumulator", "stakePerSide", v)} min={0.35} max={50} step={0.1} hint={`Total cost per pair: $${(config.hedgedAccumulator.stakePerSide * 2).toFixed(2)}`} />
                <NumberField label="Take Profit ($)" value={config.hedgedAccumulator.takeProfitUSD} onChange={(v) => updateNested("hedgedAccumulator", "takeProfitUSD", v)} min={0} step={0.5} hint="0 = ride until knocked out" />
                <NumberField label="Max Pairs" value={config.hedgedAccumulator.maxPairs} onChange={(v) => updateNested("hedgedAccumulator", "maxPairs", v)} min={1} max={5} />
                <NumberField label="Cooldown (seconds)" value={config.hedgedAccumulator.cooldownSeconds} onChange={(v) => updateNested("hedgedAccumulator", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Min Balance ($)" value={config.hedgedAccumulator.minBalance} onChange={(v) => updateNested("hedgedAccumulator", "minBalance", v)} min={0} max={1000} step={0.5} />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong> Open two ACCU contracts simultaneously — one long, one short. Cost: ${(config.hedgedAccumulator.stakePerSide * 2).toFixed(2)} per pair. In a trending market, one side compounds while the other gets knocked out quickly.</p>
                <p><strong>Risk:</strong> In choppy/sideways markets, both sides get knocked out = double loss. Works best when the market is trending.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ── All-In Recovery ─────────────────────────────────────────────── */}
        {st === "ALL_IN_RECOVERY" && (
          <AccordionItem value="allinrecovery" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold">All-In Recovery Settings</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberField label="Trigger Balance ($)" value={config.allInRecovery.triggerBalance} onChange={(v) => updateNested("allInRecovery", "triggerBalance", v)} min={1} max={1000} hint="Switch to recovery mode when balance drops below this" />
                <NumberField label="Recovery Stake ($)" value={config.allInRecovery.recoveryStake} onChange={(v) => updateNested("allInRecovery", "recoveryStake", v)} min={1} max={500} hint="Larger stake for recovery trades" />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Recovery Growth Rate: {(config.allInRecovery.recoveryGrowthRate * 100).toFixed(0)}%</Label>
                  <Slider value={[config.allInRecovery.recoveryGrowthRate * 100]} onValueChange={([v]) => updateNested("allInRecovery", "recoveryGrowthRate", v / 100)} min={1} max={5} step={1} />
                </div>
                <NumberField label="Recovery TP ($)" value={config.allInRecovery.recoveryTakeProfitUSD} onChange={(v) => updateNested("allInRecovery", "recoveryTakeProfitUSD", v)} min={0.5} max={100} step={0.5} />
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Recovery Contract Type</Label>
                  <Select value={config.allInRecovery.recoveryContractType} onValueChange={(v) => updateNested("allInRecovery", "recoveryContractType", v as "accumulator" | "rise_fall" | "even_odd")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accumulator">Accumulator (high risk, high reward)</SelectItem>
                      <SelectItem value="rise_fall">Rise/Fall (~50% win, ~95% payout)</SelectItem>
                      <SelectItem value="even_odd">Even/Odd (50% win, ~95% payout)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Max Recovery Attempts" value={config.allInRecovery.maxRecoveryAttempts} onChange={(v) => updateNested("allInRecovery", "maxRecoveryAttempts", v)} min={1} max={20} hint="Stop after this many attempts" />
                <NumberField label="Cooldown (seconds)" value={config.allInRecovery.cooldownSeconds} onChange={(v) => updateNested("allInRecovery", "cooldownSeconds", v)} min={1} max={300} />
                <NumberField label="Hard Stop Balance ($)" value={config.allInRecovery.hardStopBalance} onChange={(v) => updateNested("allInRecovery", "hardStopBalance", v)} min={0} max={500} hint="Absolute minimum — stop everything" />
              </div>
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-300 space-y-1">
                <p><strong>WARNING:</strong> This is pure degenerate gambling mode. Only for demo accounts.</p>
                <p>When balance drops below ${config.allInRecovery.triggerBalance}: switch to ${config.allInRecovery.recoveryStake} stakes. {config.allInRecovery.maxRecoveryAttempts} attempts to recover, then stop at ${config.allInRecovery.hardStopBalance} floor.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
};

export default Strategy;
