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
    <Card className="p-3 md:p-4 bg-card border-border">
      <div className="flex items-start justify-between">
        <div className="space-y-0.5 md:space-y-1 min-w-0">
          <p className="text-[10px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
          <p className="text-lg md:text-2xl font-bold font-mono text-card-foreground truncate">{value}</p>
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
        <div className={cn("p-1.5 md:p-2.5 rounded-lg shrink-0", iconClassName || "bg-primary/10")}>
          <Icon className={cn("w-4 h-4 md:w-5 md:h-5", iconClassName ? "" : "text-primary")} />
        </div>
      </div>
    </Card>
  );
});
