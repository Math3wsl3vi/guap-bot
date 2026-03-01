import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/useWebSocket";
import { CandleData } from "@/types";
import { LineChart, CandlestickChart } from "lucide-react";

const MAX_CANDLES = 60;

const UP_COLOR = "hsl(160,84%,39%)";
const DOWN_COLOR = "hsl(0,72%,51%)";
const TICK_COLOR = "hsl(215,15%,55%)";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(220,18%,12%)",
  border: "1px solid hsl(220,13%,18%)",
  borderRadius: "8px",
  fontSize: "12px",
};

interface CandlestickBarProps {
  x: number;
  width: number;
  payload: { open: number; high: number; low: number; close: number };
  background: { y: number; height: number } | null;
  yMin?: number;
  yMax?: number;
}

function CandlestickBar(props: CandlestickBarProps) {
  const { x, width, payload, background, yMin, yMax } = props;
  if (!background || !payload || yMin === undefined || yMax === undefined) return null;

  const { open, high, low, close } = payload;
  const range = yMax - yMin;
  if (range === 0) return null;

  const isGreen = close >= open;
  const color = isGreen ? UP_COLOR : DOWN_COLOR;
  const chartTop: number = background.y;
  const chartHeight: number = background.height;

  const toY = (price: number) => chartTop + ((yMax - price) / range) * chartHeight;

  const wickX = x + width / 2;
  const bodyTop = toY(Math.max(open, close));
  const bodyHeight = Math.max(1, toY(Math.min(open, close)) - bodyTop);
  const bodyWidth = Math.max(2, width * 0.65);
  const bodyX = x + (width - bodyWidth) / 2;

  return (
    <g>
      <line x1={wickX} y1={toY(high)} x2={wickX} y2={toY(low)} stroke={color} strokeWidth={1} />
      <rect
        x={bodyX}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

export function LiveChart() {
  const [timeframe, setTimeframe] = useState("1m");
  const [chartType, setChartType] = useState<"line" | "candle">("line");

  const { data: initialCandles } = useQuery({
    queryKey: ["candles"],
    queryFn: () => api.candles(MAX_CANDLES),
  });

  const [candles, setCandles] = useState<CandleData[]>([]);
  const initialSet = useRef(false);

  useEffect(() => {
    if (initialCandles && !initialSet.current) {
      initialSet.current = true;
      setCandles(initialCandles);
    }
  }, [initialCandles]);

  const { lastCandle } = useWebSocket();
  useEffect(() => {
    if (!lastCandle) return;
    setCandles((prev) => {
      const next = [...prev, lastCandle];
      return next.length > MAX_CANDLES ? next.slice(-MAX_CANDLES) : next;
    });
  }, [lastCandle]);

  const data = useMemo(
    () =>
      candles.map((c) => ({
        time: new Date(c.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        price: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [candles],
  );

  const { yMin, yMax } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 0 };
    const min = Math.min(...data.map((d) => d.low));
    const max = Math.max(...data.map((d) => d.high));
    const pad = (max - min) * 0.05;
    return { yMin: min - pad, yMax: max + pad };
  }, [data]);

  const currentPrice = data[data.length - 1]?.price ?? 0;
  const startPrice = data[0]?.price ?? 0;
  const isUp = currentPrice >= startPrice;
  const symbol = (import.meta.env.VITE_TRADING_SYMBOL as string | undefined) ?? "XAU/USD";
  const decimals = symbol.includes("JPY") ? 3 : 5;

  const sharedAxisProps = {
    xAxis: (
      <XAxis
        dataKey="time"
        tick={{ fill: TICK_COLOR, fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
      />
    ),
    yAxis: (candleDomain?: [number, number]) => (
      <YAxis
        domain={candleDomain ?? ["auto", "auto"]}
        tick={{ fill: TICK_COLOR, fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v: number) => v.toFixed(4)}
        width={60}
      />
    ),
  };

  const renderCandlestick = (props: CandlestickBarProps) => (
    <CandlestickBar {...props} yMin={yMin} yMax={yMax} />
  );

  return (
    <Card className="bg-card border-border p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 md:mb-4">
        <div className="flex items-center gap-2 md:gap-3">
          <h3 className="text-sm font-semibold text-foreground">{symbol}</h3>
          {currentPrice > 0 && (
            <span className={`font-mono text-base md:text-lg font-bold ${isUp ? "text-profit" : "text-loss"}`}>
              {currentPrice.toFixed(decimals)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <Tabs value={chartType} onValueChange={(v) => setChartType(v as "line" | "candle")}>
            <TabsList className="bg-muted h-7 md:h-8">
              <TabsTrigger
                value="line"
                className="px-1.5 md:px-2 h-6 md:h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <LineChart className="w-3.5 h-3.5" />
              </TabsTrigger>
              <TabsTrigger
                value="candle"
                className="px-1.5 md:px-2 h-6 md:h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <CandlestickChart className="w-3.5 h-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={timeframe} onValueChange={setTimeframe}>
            <TabsList className="bg-muted h-7 md:h-8">
              {["1m", "5m", "15m", "1h"].map((tf) => (
                <TabsTrigger
                  key={tf}
                  value={tf}
                  className="text-xs px-2 md:px-3 h-6 md:h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {tf}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">
          Waiting for market data…
        </div>
      ) : chartType === "line" ? (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? UP_COLOR : DOWN_COLOR} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isUp ? UP_COLOR : DOWN_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            {sharedAxisProps.xAxis}
            {sharedAxisProps.yAxis()}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: TICK_COLOR }}
              itemStyle={{ color: "hsl(210,20%,90%)" }}
              formatter={(value: number) => [value.toFixed(decimals), "Price"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={isUp ? UP_COLOR : DOWN_COLOR}
              strokeWidth={2}
              fill="url(#priceGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} barCategoryGap="10%">
            <CartesianGrid stroke="hsl(220,13%,18%)" strokeDasharray="3 3" vertical={false} />
            {sharedAxisProps.xAxis}
            {sharedAxisProps.yAxis([yMin, yMax])}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: TICK_COLOR }}
              content={({ active, label, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={TOOLTIP_STYLE} className="px-3 py-2">
                    <p className="text-xs mb-1" style={{ color: TICK_COLOR }}>{label}</p>
                    {(["O", "H", "L", "C"] as const).map((k, i) => {
                      const val = [d.open, d.high, d.low, d.close][i] as number;
                      return (
                        <p key={k} className="font-mono text-xs" style={{ color: "hsl(210,20%,90%)" }}>
                          {k}: {val.toFixed(decimals)}
                        </p>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Bar dataKey="high" shape={renderCandlestick} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
