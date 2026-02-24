import { Card, CardContent, CardHeader, CardTitle, cn } from '@enclave/ui';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import { DnsRecordsStep } from '../onboarding/DnsRecordsStep.js';
import { DomainStep } from '../onboarding/DomainStep.js';
import { FirewallStep } from '../onboarding/FirewallStep.js';
import { RegistrationToggleStep } from '../onboarding/RegistrationToggleStep.js';
import { TlsStep } from '../onboarding/TlsStep.js';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('enclave:sessionToken');
  } catch {
    return null;
  }
};

interface AdminStatusResponse {
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Panel definitions
// ---------------------------------------------------------------------------

type PanelId = 'domain' | 'dns' | 'firewall' | 'tls' | 'registration';

interface PanelDef {
  id: PanelId;
  title: string;
  description: string;
}

const PANELS: PanelDef[] = [
  {
    id: 'domain',
    title: 'Domain Configuration',
    description: 'Change your mail server\u2019s configured domain.',
  },
  {
    id: 'dns',
    title: 'DNS Records',
    description: 'View the DNS records required for your domain.',
  },
  {
    id: 'firewall',
    title: 'Firewall Ports',
    description: 'Port configuration reference for your mail server.',
  },
  {
    id: 'tls',
    title: 'TLS / SSL Certificate',
    description: 'View certificate status or trigger certbot automation.',
  },
  {
    id: 'registration',
    title: 'User Registration',
    description: 'Control who can create accounts on your server.',
  },
];

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  panel: PanelDef;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SettingsPanel = ({ panel, isOpen, onToggle, children }: SettingsPanelProps) => (
  <div className="border border-border rounded-sm overflow-hidden">
    {/* Panel header — always visible, clickable to toggle */}
    <button
      className="w-full flex items-center justify-between p-4 text-left hover:bg-surface/50 transition-colors"
      onClick={onToggle}
      type="button"
      aria-expanded={isOpen}
      aria-controls={`panel-content-${panel.id}`}
    >
      <div>
        <div className="text-ui-sm font-medium text-text-primary">{panel.title}</div>
        <div className="text-ui-xs text-text-secondary">{panel.description}</div>
      </div>
      <HugeiconsIcon
        icon={ArrowDown01Icon as IconSvgElement}
        size={16}
        className={cn(
          'text-text-secondary transition-transform shrink-0 ml-3',
          isOpen && 'rotate-180',
        )}
      />
    </button>

    {/* Panel content — shown only when open */}
    {isOpen && (
      <div id={`panel-content-${panel.id}`} className="border-t border-border p-4">
        {children}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// AdminSettings
// ---------------------------------------------------------------------------

type AdminCheckState = 'loading' | 'authorized' | 'unauthorized';

const AdminSettings = () => {
  const [state, setState] = React.useState<AdminCheckState>('loading');
  const [openPanel, setOpenPanel] = React.useState<PanelId | null>(null);
  const [sessionToken, setSessionToken] = React.useState('');
  const fetchedRef = React.useRef(false);

  const togglePanel = (id: PanelId) => {
    setOpenPanel((prev) => (prev === id ? null : id));
  };

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const token = getAuthToken();
    if (token) setSessionToken(token);

    const checkAdmin = async () => {
      if (!token) {
        window.location.href = '/mail/inbox';
        return;
      }

      try {
        const res = await fetch(`${getApiBaseUrl()}/setup/admin-status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          window.location.href = '/mail/inbox';
          return;
        }

        const data = (await res.json()) as AdminStatusResponse;

        if (!data.isAdmin) {
          window.location.href = '/mail/inbox';
          return;
        }

        setState('authorized');
      } catch {
        window.location.href = '/mail/inbox';
      }
    };

    void checkAdmin();
  }, []);

  if (state === 'loading') {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">
            Server Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3">
              <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-ui-sm text-text-secondary">Verifying admin access...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === 'unauthorized') {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render panel content for each section
  // ---------------------------------------------------------------------------

  const renderPanelContent = (id: PanelId): React.ReactNode => {
    switch (id) {
      case 'domain':
        return (
          <DomainStep
            onNext={() => {
              togglePanel('domain');
            }}
          />
        );
      case 'dns':
        return <DnsRecordsStep onNext={() => togglePanel('dns')} />;
      case 'firewall':
        return <FirewallStep onNext={() => togglePanel('firewall')} />;
      case 'tls':
        return <TlsStep onNext={() => togglePanel('tls')} />;
      case 'registration':
        return (
          <RegistrationToggleStep
            sessionToken={sessionToken}
            onNext={() => togglePanel('registration')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Card className="bg-surface border-border rounded-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-ui-base font-semibold text-text-primary">
          Server Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-text-secondary text-ui-sm">Manage your mail server configuration.</p>

          {PANELS.map((panel) => (
            <SettingsPanel
              key={panel.id}
              panel={panel}
              isOpen={openPanel === panel.id}
              onToggle={() => togglePanel(panel.id)}
            >
              {renderPanelContent(panel.id)}
            </SettingsPanel>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export { AdminSettings };
