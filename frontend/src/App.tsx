import { Component, ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import Strategy from "./pages/Strategy";
import Logs from "./pages/Logs";
import Trades from "./pages/Trades";
import Backtesting from "./pages/Backtesting";
import NotFound from "./pages/NotFound";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 bg-background text-foreground p-8">
          <p className="text-destructive font-semibold text-lg">Something went wrong</p>
          <pre className="text-xs text-muted-foreground bg-muted rounded p-4 max-w-xl overflow-auto">
            {(this.state.error as Error).message}
          </pre>
          <button className="text-sm underline text-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 30s — prevents spurious re-renders between poll cycles
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Layout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/trades" element={<Trades />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/strategy" element={<Strategy />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/backtesting" element={<Backtesting />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </Layout>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
