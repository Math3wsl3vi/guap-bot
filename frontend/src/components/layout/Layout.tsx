import { useState, useCallback } from "react";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleMobile = useCallback(() => setMobileOpen((o) => !o), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar — always visible */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={closeMobile} />
          <div className="relative h-full w-60 animate-in slide-in-from-left duration-200">
            <AppSidebar onClose={closeMobile} />
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar onMenuToggle={toggleMobile} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
