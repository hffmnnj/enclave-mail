import { QueryClient } from '@tanstack/react-query';

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 3,
      },
    },
  });

let _queryClient: QueryClient | null = null;

export const getQueryClient = () => {
  if (typeof window !== 'undefined') {
    if (!_queryClient) {
      _queryClient = createQueryClient();
    }
    return _queryClient;
  }
  // Server-side: always create a fresh instance to avoid cross-request leaks
  return createQueryClient();
};
