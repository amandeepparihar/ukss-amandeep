import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { RefreshCw, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  level: number;
  time: number;
  executionId: string | null;
  msg: string;
  data: Record<string, unknown>;
  raw: string;
}
interface LogPage {
  rows: LogEntry[];
  nextCursor: number | null;
  skipped: number;
}

const LEVELS = ['all', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function levelLabel(level: number): { text: string; cls: string } {
  if (level >= 50) return { text: 'ERROR', cls: 'bg-red-100 text-red-800' };
  if (level >= 40) return { text: 'WARN', cls: 'bg-amber-100 text-amber-800' };
  if (level >= 30) return { text: 'INFO', cls: 'bg-emerald-100 text-emerald-800' };
  return { text: 'TRACE', cls: 'bg-slate-100 text-slate-700' };
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London' });
}

export function LogsPage() {
  const [module, setModule] = useState<string>('');
  const [level, setLevel] = useState<Level>('all');
  const [q, setQ] = useState('');
  const [executionId, setExecutionId] = useState('');
  const [cursor, setCursor] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const modulesQuery = useQuery({
    queryKey: ['logs', 'modules'],
    queryFn: async () => (await api.get<{ data: string[] }>('/logs/modules')).data.data,
  });

  // Alphabetically sorted module options for the searchable dropdown.
  // (The API already sorts; this is a defensive client-side sort.)
  const moduleOptions = (modulesQuery.data ?? [])
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((m) => ({ value: m, label: m }));

  const params = new URLSearchParams();
  params.set('level', level);
  params.set('cursor', String(cursor));
  params.set('limit', '100');
  if (q) params.set('q', q);
  if (executionId) params.set('executionId', executionId);

  const logsQuery = useQuery({
    queryKey: ['logs', module, level, q, executionId, cursor],
    enabled: !!module,
    refetchInterval: autoRefresh ? 5000 : false,
    queryFn: async () =>
      (await api.get<{ data: LogPage }>(`/logs/${module}?${params.toString()}`)).data.data,
  });

  const resetPaging = () => { setCursor(0); setExpanded(new Set()); };

  const onExport = async () => {
    const exp = new URLSearchParams(params);
    exp.delete('cursor');
    exp.delete('limit');
    const res = await api.get(`/logs/${module}/export?${exp.toString()}`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().split('T')[0];
    a.download = `logs_${module}_${ts}.ndjson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Logs</h1>

      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={module}
          onChange={(v) => { setModule(v); resetPaging(); }}
          options={moduleOptions}
          placeholder="Select module…"
          className="h-9 w-[260px]"
        />

        {/* Kept in severity order (all → error), NOT alphabetical: alphabetising
            severity reads all/error/info/warn, which is less intuitive than the
            natural escalation. Flip LEVEL_OPTIONS to sorted if strict A-Z is required. */}
        <SearchableSelect
          value={level}
          onChange={(v) => { setLevel(v as Level); resetPaging(); }}
          options={LEVELS.map((l) => ({ value: l, label: l.toUpperCase() }))}
          placeholder="Level"
          className="h-9 w-[130px]"
        />

        <Input
          placeholder="Search message…"
          className="h-9 w-48"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && resetPaging()}
        />
        <Input
          placeholder="Execution ID"
          className="h-9 w-56"
          value={executionId}
          onChange={(e) => setExecutionId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && resetPaging()}
        />

        <Button variant="outline" size="sm" onClick={() => { resetPaging(); logsQuery.refetch(); }}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto 5s
        </label>
        <Button variant="outline" size="sm" onClick={onExport} disabled={!module}>
          <Download className="mr-1 h-4 w-4" /> Export
        </Button>
      </div>

      {!module && <p className="text-muted-foreground">Pick a module to view its logs.</p>}

      {module && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="w-8 p-2"></th>
                <th className="w-44 p-2">Time</th>
                <th className="w-20 p-2">Level</th>
                <th className="w-56 p-2">Execution ID</th>
                <th className="p-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logsQuery.data?.rows.map((row, i) => {
                const lvl = levelLabel(row.level);
                const isOpen = expanded.has(i);
                return (
                  <Fragment key={i}>
                    <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={() => toggle(i)}>
                      <td className="p-2">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="p-2 font-mono text-xs">{fmtTime(row.time)}</td>
                      <td className="p-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', lvl.cls)}>{lvl.text}</span></td>
                      <td className="p-2 font-mono text-xs">
                        <button
                          className="hover:underline"
                          onClick={(e) => { e.stopPropagation(); setExecutionId(row.executionId ?? ''); resetPaging(); }}
                        >
                          {row.executionId ?? '—'}
                        </button>
                      </td>
                      <td className="p-2">{row.msg}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-muted/20">
                        <td></td>
                        <td colSpan={4} className="p-2">
                          <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
                            {JSON.stringify(row.data, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {logsQuery.data && logsQuery.data.rows.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No log lines match.</td></tr>
              )}
            </tbody>
          </table>

          <div className="flex items-center justify-between p-2 text-sm">
            <span className="text-muted-foreground">
              {logsQuery.data?.skipped ? `${logsQuery.data.skipped} malformed line(s) skipped` : ''}
            </span>
            <div className="flex gap-2">
              {cursor > 0 && (
                <Button variant="outline" size="sm" onClick={() => { setCursor(0); setExpanded(new Set()); }}>
                  Newest
                </Button>
              )}
              {logsQuery.data?.nextCursor != null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setCursor(logsQuery.data!.nextCursor!); setExpanded(new Set()); }}
                >
                  Load older
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LogsPage;
