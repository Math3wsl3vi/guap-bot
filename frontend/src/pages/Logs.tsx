import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Search } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const levelColors: Record<string, string> = {
  DEBUG: "text-muted-foreground",
  INFO: "text-primary",
  WARN: "text-warning",
  ERROR: "text-loss",
};

const levelBg: Record<string, string> = {
  DEBUG: "bg-muted",
  INFO: "bg-primary/10",
  WARN: "bg-warning/10",
  ERROR: "bg-loss/10",
};

const Logs = () => {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const { data: logs = [] } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.logs(200),
    refetchInterval: 3_000,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 10_000,
  });

  const filtered = logs.filter((l) => {
    if (filter !== "ALL" && l.level !== filter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const h = health ?? {
    apiConnection: false,
    webSocket: false,
    database: false,
    redis: false,
    latency: 0,
    uptime: 0,
    cpuUsage: 0,
    memoryUsage: 0,
  };

  const statusItems = [
    { label: "API Connection", ok: h.apiConnection },
    { label: "WebSocket", ok: h.webSocket },
    { label: "Database", ok: h.database },
    { label: "Redis", ok: h.redis },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">System Logs</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statusItems.map((s) => (
          <Card key={s.label} className="p-4 bg-card border-border flex items-center gap-3">
            {s.ok ? (
              <CheckCircle className="w-5 h-5 text-profit" />
            ) : (
              <XCircle className="w-5 h-5 text-loss" />
            )}
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-medium ${s.ok ? "text-profit" : "text-loss"}`}>
                {s.ok ? "Connected" : "Down"}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground">Latency</p>
          <p className="text-xl font-bold font-mono text-foreground">
            {h.latency >= 0 ? `${h.latency}ms` : "—"}
          </p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground">Uptime</p>
          <p className="text-xl font-bold font-mono text-foreground">
            {Math.floor(h.uptime / 86400)}d {Math.floor((h.uptime % 86400) / 3600)}h
          </p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground">CPU</p>
          <p className="text-xl font-bold font-mono text-foreground">{h.cpuUsage}%</p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground">Memory</p>
          <p className="text-xl font-bold font-mono text-foreground">{h.memoryUsage}%</p>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="pl-9 font-mono text-sm"
            />
          </div>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="bg-muted h-9">
              {["ALL", "DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
                <TabsTrigger
                  key={l}
                  value={l}
                  className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {l}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="p-2 max-h-[500px] overflow-auto space-y-0.5 font-mono text-xs">
          {filtered.map((log) => (
            <div
              key={log.id}
              className="flex gap-3 px-3 py-2 rounded hover:bg-accent/50 transition-colors"
            >
              <span className="text-muted-foreground shrink-0 w-20">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "border-0 text-[10px] font-mono shrink-0 w-12 justify-center",
                  levelBg[log.level],
                  levelColors[log.level],
                )}
              >
                {log.level}
              </Badge>
              <span className="text-muted-foreground shrink-0 w-24">[{log.component}]</span>
              <span className="text-foreground">{log.message}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No logs match your filters</p>
          )}
        </div>
      </Card>
    </div>
  );
};

export default Logs;
