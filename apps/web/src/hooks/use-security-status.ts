import { useQuery } from '@tanstack/react-query';

interface SecurityStatus {
  connection: 'connected' | 'disconnected' | 'checking';
  encryptionMode: 'e2e' | 'transport' | 'none';
  keyFingerprint: string | null;
  serverVersion: string | null;
  lastChecked: Date | null;
}

interface HealthResponse {
  status: string;
  version?: string;
}

const fetchServerHealth = async (): Promise<HealthResponse> => {
  const baseUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL
      ? (import.meta.env.PUBLIC_API_URL as string)
      : 'http://localhost:3001';

  const res = await fetch(`${baseUrl}/api/health`, {
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) {
    throw new Error(`Server returned ${String(res.status)}`);
  }

  return (await res.json()) as HealthResponse;
};

const readKeyFingerprint = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('enclave:activeKeyFingerprint');
  } catch {
    return null;
  }
};

const useSecurityStatus = (): SecurityStatus => {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['server-health'],
    queryFn: fetchServerHealth,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 20_000,
  });

  const keyFingerprint = readKeyFingerprint();

  return {
    connection: isLoading ? 'checking' : isError ? 'disconnected' : 'connected',
    encryptionMode: keyFingerprint ? 'e2e' : 'transport',
    keyFingerprint,
    serverVersion: data?.version ?? null,
    lastChecked: data ? new Date() : null,
  };
};

export { useSecurityStatus };
export type { SecurityStatus };
