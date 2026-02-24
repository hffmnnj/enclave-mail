import { Card, CardContent, CardHeader, CardTitle } from '@enclave/ui';
import * as React from 'react';

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
// AdminSettings
// ---------------------------------------------------------------------------

type AdminCheckState = 'loading' | 'authorized' | 'unauthorized';

const AdminSettings = () => {
  const [state, setState] = React.useState<AdminCheckState>('loading');
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const checkAdmin = async () => {
      const token = getAuthToken();

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

  return (
    <Card className="bg-surface border-border rounded-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-ui-base font-semibold text-text-primary">
          Server Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <p className="text-text-secondary text-ui-sm">Manage your mail server configuration.</p>
          {/* Panels will be added in Task 4.2 */}
        </div>
      </CardContent>
    </Card>
  );
};

export { AdminSettings };
