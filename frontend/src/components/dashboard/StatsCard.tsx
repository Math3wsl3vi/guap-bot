import { memo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  iconClassName?: string;
}

export const StatsCard = memo(function StatsCard({ title, value, change, changeType = 'neutral', icon: Icon, iconClassName }: StatsCardProps) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold font-mono text-card-foreground">{value}</p>
          {change && (
            <p className={cn(
              "text-xs font-mono font-medium",
              changeType === 'positive' && 'text-profit',
              changeType === 'negative' && 'text-loss',
              changeType === 'neutral' && 'text-muted-foreground'
            )}>
              {change}
            </p>
          )}
        </div>
        <div className={cn("p-2.5 rounded-lg", iconClassName || "bg-primary/10")}>
          <Icon className={cn("w-5 h-5", iconClassName ? "" : "text-primary")} />
        </div>
      </div>
    </Card>
  );
});
