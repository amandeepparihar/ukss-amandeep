import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ───────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  marketplace: string;
  store?: string;
  phase: string;
  message: string;
  details?: Record<string, unknown>;
}

interface LogsResponse {
  runId: string | null;
  logs: LogEntry[];
}

interface ReconciliationLogsTabProps {
  isRunning: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const DETAIL_LABELS: Record<string, string> = {
  durationMs: 'Duration',
  orderCount: 'Orders',
  recordCount: 'Count',
  httpStatus: 'HTTP',
  errorMessage: 'Error',
  retryAttempt: 'Retry',
  endpoint: 'Endpoint',
};

function formatDetailValue(key: string, value: unknown): string {
  if (key === 'durationMs' && typeof value === 'number') {
    return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
  }
  return String(value);
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${DETAIL_LABELS[k] || k}: ${formatDetailValue(k, v)}`)
    .join('  ·  ');
}

function LevelBadge({ level }: { level: LogLevel }) {
  switch (level) {
    case 'error':
      return <Badge variant="destructive">error</Badge>;
    case 'warn':
      return (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          warn
        </Badge>
      );
    default:
      return <Badge variant="secondary">info</Badge>;
  }
}

// ─── Component ───────────────────────────────────────────────

export function ReconciliationLogsTab({ isRunning }: ReconciliationLogsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize filter state from URL params
  const initialLevels = useMemo(() => {
    const param = searchParams.get('levels');
    if (!param) return { info: true, warn: true, error: true };
    const enabled = new Set(param.split(','));
    return {
      info: enabled.has('info'),
      warn: enabled.has('warn'),
      error: enabled.has('error'),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>(initialLevels);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>(
    searchParams.get('logMp') ?? 'all'
  );

  // Sync filter state → URL
  useEffect(() => {
    const enabledLevels = (Object.keys(levelFilters) as LogLevel[]).filter((l) => levelFilters[l]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('levels', enabledLevels.join(','));
      if (marketplaceFilter === 'all') {
        next.delete('logMp');
      } else {
        next.set('logMp', marketplaceFilter);
      }
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelFilters, marketplaceFilter]);

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const prevLogCountRef = useRef(0);

  // Fetch logs with polling
  const { data } = useQuery<LogsResponse>({
    queryKey: ['reconciliation-logs'],
    queryFn: () => api.get('/reconciliation/logs').then((r) => r.data.data),
    refetchInterval: isRunning ? 3000 : false,
  });

  const logs = data?.logs ?? [];

  // Derive marketplace options from log data, excluding 'ALL' (summary entries)
  const marketplaceOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of logs) {
      if (entry.marketplace && entry.marketplace !== 'ALL') {
        unique.add(entry.marketplace);
      }
    }
    return Array.from(unique).sort();
  }, [logs]);

  // Apply filters — summary entries (marketplace='ALL') always pass the marketplace filter
  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (!levelFilters[entry.level]) return false;
      if (
        marketplaceFilter !== 'all' &&
        entry.marketplace !== marketplaceFilter &&
        entry.marketplace !== 'ALL'
      )
        return false;
      return true;
    });
  }, [logs, levelFilters, marketplaceFilter]);

  // Detect manual scroll (user scrolled away from bottom)
  const handleScroll = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  // Attach scroll listener to the viewport
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && filteredLogs.length > prevLogCountRef.current) {
      sentinelRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLogCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, autoScroll]);

  const toggleLevel = (level: LogLevel) => {
    setLevelFilters((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-6">
        {/* Level checkboxes */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Level:</span>
          {(['info', 'warn', 'error'] as const).map((level) => (
            <div key={level} className="flex items-center gap-1.5">
              <Checkbox
                id={`log-level-${level}`}
                checked={levelFilters[level]}
                onCheckedChange={() => toggleLevel(level)}
              />
              <Label htmlFor={`log-level-${level}`} className="cursor-pointer text-sm">
                {level}
              </Label>
            </div>
          ))}
        </div>

        {/* Marketplace dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Marketplace:</span>
          <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {marketplaceOptions.map((mp) => (
                <SelectItem key={mp} value={mp}>
                  {mp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Log entries */}
      <ScrollArea className="h-[500px] rounded-md border">
        <div
          ref={(el) => {
            // Grab the actual scrollable viewport (Radix wraps content in a viewport div)
            if (el) {
              const viewport = el.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
              if (viewport) {
                scrollViewportRef.current = viewport;
              }
            }
          }}
          className="p-4 font-mono text-sm"
        >
          {filteredLogs.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No logs available</p>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-0.5 py-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-muted-foreground">
                      {formatTime(entry.timestamp)}
                    </span>
                    <LevelBadge level={entry.level} />
                    <Badge variant="outline" className="shrink-0">
                      {entry.marketplace}
                    </Badge>
                    <span className="break-words">{entry.message}</span>
                  </div>
                  {entry.details && Object.keys(entry.details).length > 0 && (
                    <p className="ml-[88px] text-xs text-muted-foreground">
                      {formatDetails(entry.details)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Sentinel for auto-scroll */}
          <div ref={sentinelRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
