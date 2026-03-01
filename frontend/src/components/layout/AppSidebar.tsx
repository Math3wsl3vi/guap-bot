import { NavLink } from "@/components/NavLink";

import { LayoutDashboard, BarChart3, Settings2, Terminal, Clock, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Strategy", url: "/strategy", icon: Settings2 },
  { title: "Logs", url: "/logs", icon: Terminal },
  { title: "Backtesting", url: "/backtesting", icon: Clock },
];

interface AppSidebarProps {
  onClose?: () => void;
}

export function AppSidebar({ onClose }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  // In mobile mode (onClose provided), always show expanded
  const isCollapsed = onClose ? false : collapsed;

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 shrink-0 h-full",
        isCollapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border h-16">
        <div className="flex items-center gap-2">
          <img src="/images/logo.png" alt="GuapBot" className="w-8 h-8 rounded-lg object-contain" />
          {!isCollapsed && <span className="text-lg font-bold text-foreground tracking-tight">ScalpX</span>}
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-sidebar-accent transition-colors">
            <X className="w-5 h-5 text-sidebar-foreground" />
          </button>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.url}
            to={item.url}
            end
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isCollapsed && "justify-center px-0"
            )}
            activeClassName="bg-sidebar-accent text-primary"
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>{item.title}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      {!onClose && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      )}
    </aside>
  );
}
