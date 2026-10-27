import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AnnouncementBanner } from './AnnouncementBanner';

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  // Tracks whether we've already auto-collapsed for the deliveries module in
  // this session. After the first visit, the user's manual toggle wins — we
  // never force it closed again, even if they come back to /deliveries.
  const deliveriesAutoCollapsedRef = useRef(false);

  useEffect(() => {
    // Auto-collapse the sidebar the FIRST time the user lands on the
    // deliveries module in this session. The grid is column-heavy and the
    // sidebar steals ~256px of width that's better spent on grid columns.
    // Only fires once per page load — subsequent visits respect whatever
    // state the user left the sidebar in.
    if (
      !deliveriesAutoCollapsedRef.current &&
      location.pathname.startsWith('/deliveries')
    ) {
      deliveriesAutoCollapsedRef.current = true;
      setSidebarCollapsed(true);
    }
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          onMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <AnnouncementBanner />
        <main className="flex-1 overflow-auto bg-muted/40 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
