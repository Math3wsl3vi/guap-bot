import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

const Backtesting = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <Card className="p-12 bg-card border-border text-center max-w-md">
        <div className="flex justify-center mb-4">
          <div className="p-4 rounded-2xl bg-primary/10">
            <Clock className="w-10 h-10 text-primary" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Backtesting</h2>
        <p className="text-muted-foreground text-sm mb-6">
          Test your strategies against historical data. This feature is coming soon.
        </p>
        <Button disabled>Coming Soon</Button>
      </Card>
    </div>
  );
};

export default Backtesting;
