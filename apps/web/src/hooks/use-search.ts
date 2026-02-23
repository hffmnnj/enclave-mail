import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import type { MessageListItem, PaginatedMessages } from './use-messages.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchFilters {
  seen?: boolean;
  flagged?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

interface SearchResult {
  results: MessageListItem[];
  isSearching: boolean;
  resultCount: number;
}

// ---------------------------------------------------------------------------
// API helpers (same pattern as use-messages.ts)
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

const authHeaders = (): HeadersInit => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

// ---------------------------------------------------------------------------
// Server-side search — queries metadata (sender, recipient) via API
// ---------------------------------------------------------------------------

const fetchSearchResults = async (
  mailboxId: string,
  query: string,
  filters: SearchFilters,
): Promise<PaginatedMessages> => {
  const base = getApiBaseUrl();
  const params = new URLSearchParams({
    offset: '0',
    limit: '50',
  });

  if (query.trim()) {
    params.set('search', query.trim());
  }

  if (filters.seen !== undefined) {
    params.set('seen', String(filters.seen));
  }

  if (filters.flagged !== undefined) {
    params.set('flagged', String(filters.flagged));
  }

  const res = await fetch(`${base}/mailboxes/${mailboxId}/messages?${params.toString()}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Search failed: ${String(res.status)}`);
  }

  return (await res.json()) as PaginatedMessages;
};

// ---------------------------------------------------------------------------
// Client-side filtering — filters cached/decrypted messages in the browser
// ---------------------------------------------------------------------------

const applyClientSideFilters = (
  messages: MessageListItem[],
  query: string,
  filters: SearchFilters,
): MessageListItem[] => {
  let filtered = messages;

  // Date range filtering (client-side since server may not support it)
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    filtered = filtered.filter((m) => new Date(m.date).getTime() >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86_400_000; // Include the full day
    filtered = filtered.filter((m) => new Date(m.date).getTime() < to);
  }

  // Client-side text search on decrypted content
  // When @enclave/crypto is bundled for browser, decrypted subjects/bodies
  // will be available in the TanStack Query cache. For now, this searches
  // the fromAddress and toAddresses fields client-side as a supplement.
  if (query.trim()) {
    const lowerQuery = query.trim().toLowerCase();
    filtered = filtered.filter((m) => {
      const fromMatch = m.fromAddress.toLowerCase().includes(lowerQuery);
      const toMatch = m.toAddresses.some((addr) => addr.toLowerCase().includes(lowerQuery));
      return fromMatch || toMatch;
    });
  }

  return filtered;
};

// ---------------------------------------------------------------------------
// Hook — combined server + client search
// ---------------------------------------------------------------------------

const isSearchActive = (query: string, filters: SearchFilters): boolean => {
  return (
    query.trim().length > 0 ||
    filters.seen !== undefined ||
    filters.flagged !== undefined ||
    !!filters.dateFrom ||
    !!filters.dateTo
  );
};

const useSearch = (mailboxId: string, query: string, filters: SearchFilters): SearchResult => {
  const queryClient = useQueryClient();
  const active = isSearchActive(query, filters);

  // Server-side search query
  const { data, isLoading } = useQuery({
    queryKey: ['search', mailboxId, query, filters] as const,
    queryFn: () => fetchSearchResults(mailboxId, query, filters),
    enabled: active && !!mailboxId,
    staleTime: 10_000,
  });

  // Merge with client-side filtering
  const results = React.useMemo(() => {
    if (!active) return [];

    // Start with server results
    const serverResults = data?.data ?? [];

    // Also check the TanStack Query cache for already-loaded messages
    // This enables client-side filtering on data the user has already fetched
    const cachedQueries = queryClient.getQueriesData<PaginatedMessages>({
      queryKey: ['messages', mailboxId],
    });

    const cachedMessages: MessageListItem[] = [];
    for (const [, cachedData] of cachedQueries) {
      if (cachedData?.data) {
        cachedMessages.push(...cachedData.data);
      }
    }

    // Apply client-side filters to cached messages
    const clientFiltered = applyClientSideFilters(cachedMessages, query, filters);

    // Merge and deduplicate (server results take priority)
    const seen = new Set<string>();
    const merged: MessageListItem[] = [];

    for (const msg of serverResults) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        merged.push(msg);
      }
    }

    for (const msg of clientFiltered) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        merged.push(msg);
      }
    }

    // Sort by date descending
    merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return merged;
  }, [active, data, queryClient, mailboxId, query, filters]);

  return {
    results,
    isSearching: isLoading && active,
    resultCount: results.length,
  };
};

// ---------------------------------------------------------------------------
// State management hook — manages search query + filters
// ---------------------------------------------------------------------------

const parseUrlSearchState = (): { query: string; filters: SearchFilters } => {
  if (typeof window === 'undefined') return { query: '', filters: {} };

  const params = new URLSearchParams(window.location.search);
  const query = params.get('search') ?? '';
  const filters: SearchFilters = {};

  const seen = params.get('seen');
  if (seen === 'true') filters.seen = true;
  if (seen === 'false') filters.seen = false;

  const flagged = params.get('flagged');
  if (flagged === 'true') filters.flagged = true;

  const dateFrom = params.get('dateFrom');
  if (dateFrom) filters.dateFrom = dateFrom;

  const dateTo = params.get('dateTo');
  if (dateTo) filters.dateTo = dateTo;

  return { query, filters };
};

const syncUrlSearchState = (query: string, filters: SearchFilters): void => {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams();

  if (query.trim()) {
    params.set('search', query.trim());
  }

  if (filters.seen !== undefined) {
    params.set('seen', String(filters.seen));
  }

  if (filters.flagged !== undefined) {
    params.set('flagged', String(filters.flagged));
  }

  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo);
  }

  const search = params.toString();
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;

  window.history.replaceState(null, '', url);
};

const useSearchState = () => {
  const [query, setQueryRaw] = React.useState(() => parseUrlSearchState().query);
  const [filters, setFiltersRaw] = React.useState<SearchFilters>(
    () => parseUrlSearchState().filters,
  );

  const active = isSearchActive(query, filters);

  const setQuery = React.useCallback(
    (value: string) => {
      setQueryRaw(value);
      syncUrlSearchState(value, filters);
    },
    [filters],
  );

  const setFilters = React.useCallback(
    (value: SearchFilters | ((prev: SearchFilters) => SearchFilters)) => {
      setFiltersRaw((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        syncUrlSearchState(query, next);
        return next;
      });
    },
    [query],
  );

  const clearSearch = React.useCallback(() => {
    setQueryRaw('');
    setFiltersRaw({});
    syncUrlSearchState('', {});
  }, []);

  return {
    query,
    setQuery,
    filters,
    setFilters,
    clearSearch,
    isSearchActive: active,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { useSearch, useSearchState, isSearchActive };
export type { SearchFilters, SearchResult };
