import * as React from 'react';

import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

// ---------------------------------------------------------------------------
// MobileShell — coordinates sidebar drawer state between Header and Sidebar
//
// In Astro, React islands are isolated. This wrapper component provides
// shared state so the Header hamburger button can open the Sidebar drawer
// on mobile. On tablet/desktop the sidebar manages its own state.
// ---------------------------------------------------------------------------

interface MobileShellProps {
  currentPath?: string | undefined;
  children?: React.ReactNode | undefined;
}

const MobileShell = ({ currentPath = '/', children }: MobileShellProps) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const handleMenuOpen = React.useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleMenuClose = React.useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentPath={currentPath} isOpen={sidebarOpen} onClose={handleMenuClose} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuOpen={handleMenuOpen} />

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};

export { MobileShell };
export type { MobileShellProps };
