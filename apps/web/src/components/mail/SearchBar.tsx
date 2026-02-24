import { Badge, Button, Input, cn } from '@enclave/ui';
import {
  Calendar03Icon,
  Cancel01Icon,
  Flag02Icon,
  Mail01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import type { SearchFilters } from '../../hooks/use-search.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SearchBarProps {
  mailboxId: string;
  onSearch: (query: string, filters: SearchFilters) => void;
  query?: string;
  filters?: SearchFilters;
  resultCount?: number;
  isSearching?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

const useDebounce = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};

// ---------------------------------------------------------------------------
// Date range popover (inline)
// ---------------------------------------------------------------------------

interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClose: () => void;
}

const DateRangePicker = ({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClose,
}: DateRangePickerProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-50 mt-1 rounded border border-border bg-surface p-3 shadow-lg"
      aria-label="Select date range"
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="search-date-from" className="text-ui-xs text-text-secondary">
            From
          </label>
          <input
            id="search-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 font-mono text-ui-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <span className="mt-4 text-ui-xs text-text-secondary">–</span>
        <div className="flex flex-col gap-1">
          <label htmlFor="search-date-to" className="text-ui-xs text-text-secondary">
            To
          </label>
          <input
            id="search-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 font-mono text-ui-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" className="h-6 text-ui-xs" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

interface FilterChipProps {
  label: string;
  icon: typeof Mail01Icon;
  active: boolean;
  onClick: () => void;
}

const FilterChip = ({ label, icon, active, onClick }: FilterChipProps) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0 text-ui-xs font-medium transition-colors duration-fast',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      active
        ? 'border-secondary/30 bg-secondary/10 text-secondary'
        : 'border-border bg-transparent text-text-secondary hover:border-border hover:bg-surface',
    )}
    aria-pressed={active}
  >
    <HugeiconsIcon icon={icon as IconSvgElement} size={11} strokeWidth={1.5} />
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// SearchBar component
// ---------------------------------------------------------------------------

const SearchBar = ({
  onSearch,
  query: externalQuery = '',
  filters: externalFilters,
  resultCount,
  isSearching,
  className,
}: SearchBarProps) => {
  const [localQuery, setLocalQuery] = React.useState(externalQuery);
  const [localFilters, setLocalFilters] = React.useState<SearchFilters>(externalFilters ?? {});
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync external query changes
  React.useEffect(() => {
    setLocalQuery(externalQuery);
  }, [externalQuery]);

  // Sync external filter changes
  React.useEffect(() => {
    if (externalFilters) {
      setLocalFilters(externalFilters);
    }
  }, [externalFilters]);

  // Debounce the query input
  const debouncedQuery = useDebounce(localQuery, 300);

  // Fire onSearch when debounced query or filters change
  const prevSearchRef = React.useRef({ query: debouncedQuery, filters: localFilters });
  React.useEffect(() => {
    const prev = prevSearchRef.current;
    if (
      prev.query !== debouncedQuery ||
      JSON.stringify(prev.filters) !== JSON.stringify(localFilters)
    ) {
      prevSearchRef.current = { query: debouncedQuery, filters: localFilters };
      onSearch(debouncedQuery, localFilters);
    }
  }, [debouncedQuery, localFilters, onSearch]);

  // Immediate search on Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearch(localQuery, localFilters);
    }
  };

  // Clear search input
  const handleClearQuery = () => {
    setLocalQuery('');
    onSearch('', localFilters);
    inputRef.current?.focus();
  };

  // Toggle filter chips
  const toggleUnread = () => {
    setLocalFilters((prev) => {
      // Toggle: undefined → false (unread only) → undefined
      if (prev.seen === false) {
        const { seen: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, seen: false as const };
    });
  };

  const toggleFlagged = () => {
    setLocalFilters((prev) => {
      if (prev.flagged === true) {
        const { flagged: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, flagged: true as const };
    });
  };

  // Date range handlers
  const handleDateFromChange = (value: string) => {
    setLocalFilters((prev) => {
      if (value) {
        return { ...prev, dateFrom: value };
      }
      const { dateFrom: _, ...rest } = prev;
      return rest;
    });
  };

  const handleDateToChange = (value: string) => {
    setLocalFilters((prev) => {
      if (value) {
        return { ...prev, dateTo: value };
      }
      const { dateTo: _, ...rest } = prev;
      return rest;
    });
  };

  // Clear all filters
  const handleClearAll = () => {
    setLocalQuery('');
    setLocalFilters({});
    setShowDatePicker(false);
    onSearch('', {});
    inputRef.current?.focus();
  };

  const hasActiveFilters =
    localFilters.seen !== undefined ||
    localFilters.flagged !== undefined ||
    !!localFilters.dateFrom ||
    !!localFilters.dateTo;

  const hasAnySearch = localQuery.trim().length > 0 || hasActiveFilters;
  const hasDateRange = !!localFilters.dateFrom || !!localFilters.dateTo;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* Search input row */}
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon as IconSvgElement}
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <Input
          ref={inputRef}
          type="search"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search messages..."
          className="h-7 pl-7 pr-7 text-ui-sm"
          aria-label="Search messages"
        />
        {localQuery.length > 0 && (
          <button
            type="button"
            onClick={handleClearQuery}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Clear search"
          >
            <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Filter chips row */}
      <div className="relative flex flex-wrap items-center gap-1.5">
        <FilterChip
          label="Unread"
          icon={Mail01Icon}
          active={localFilters.seen === false}
          onClick={toggleUnread}
        />
        <FilterChip
          label="Flagged"
          icon={Flag02Icon}
          active={localFilters.flagged === true}
          onClick={toggleFlagged}
        />
        <FilterChip
          label={
            hasDateRange
              ? formatDateRangeLabel(localFilters.dateFrom, localFilters.dateTo)
              : 'Date range'
          }
          icon={Calendar03Icon}
          active={hasDateRange}
          onClick={() => setShowDatePicker((prev) => !prev)}
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="ml-1 text-ui-xs text-text-secondary underline decoration-text-secondary/30 underline-offset-2 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Clear all
          </button>
        )}

        {/* Date range popover */}
        {showDatePicker && (
          <DateRangePicker
            dateFrom={localFilters.dateFrom ?? ''}
            dateTo={localFilters.dateTo ?? ''}
            onDateFromChange={handleDateFromChange}
            onDateToChange={handleDateToChange}
            onClose={() => setShowDatePicker(false)}
          />
        )}
      </div>

      {/* Result count */}
      {hasAnySearch && (
        <div className="flex items-center gap-2">
          {isSearching ? (
            <span className="text-ui-xs text-text-secondary">Searching...</span>
          ) : (
            <Badge variant="outline" className="font-mono">
              {resultCount ?? 0} result{resultCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDateRangeLabel = (from?: string, to?: string): string => {
  if (from && to) {
    return `${formatShortDate(from)} – ${formatShortDate(to)}`;
  }
  if (from) {
    return `From ${formatShortDate(from)}`;
  }
  if (to) {
    return `Until ${formatShortDate(to)}`;
  }
  return 'Date range';
};

const formatShortDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { SearchBar };
export type { SearchBarProps };
