import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  useOrderStatuses, useMarketplaces, useHourlyReport, useDownloadHourlyCsv,
  type HourlyFilters,
} from './hooks/useHourlyReport';
import { HourlyComparisonChart } from './HourlyComparisonChart';

const HOURS = Array.from({ length: 24 }, (_, h) => `h${String(h).padStart(2, '0')}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Format a 'YYYY-MM-DD' string as '09-Jun-2026'. Parses the string directly
// (no Date object) to avoid any timezone shift.
function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

export function HourlySalesReport() {
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(6));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));
  const [orderStatuses, setOrderStatuses] = useState<string[]>([]);
  const [channel, setChannel] = useState<HourlyFilters['channel']>('both');
  const [marketplace, setMarketplace] = useState('');

  const statuses = useOrderStatuses();
  const marketplaces = useMarketplaces(channel === 'marketplace');
  const filters: HourlyFilters = { dateFrom, dateTo, orderStatuses, channel, marketplace };
  const report = useHourlyReport(filters);
  const download = useDownloadHourlyCsv();

  const statusOptions = useMemo(
    () => (statuses.data ?? []).map((s) => ({ value: String(s.id), label: s.name })),
    [statuses.data],
  );
  const marketplaceOptions = useMemo(
    () => (marketplaces.data ?? []).map((m) => ({ value: String(m.id), label: m.name })),
    [marketplaces.data],
  );

  // The shared reports preview endpoint caps results at 100 rows. Since this
  // report returns one row per day, a range wider than that would be silently
  // truncated — so we cap the selectable span instead of shipping partial data.
  const MAX_RANGE_DAYS = 92;
  const minFrom = useMemo(() => {
    const d = new Date(`${dateTo}T00:00:00`);
    d.setDate(d.getDate() - (MAX_RANGE_DAYS - 1));
    return d.toISOString().slice(0, 10);
  }, [dateTo]);

  // Column totals for the footer: per-hour sum across all days + grand total.
  const rows = report.data ?? [];
  const hourTotals = useMemo(
    () => HOURS.map((h) => rows.reduce((sum, row) => sum + Number(row[h] ?? 0), 0)),
    [rows],
  );
  const grandTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    [rows],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm gap-1">From
            <input
              type="date"
              value={dateFrom}
              min={minFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm gap-1">To
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </label>
          <div className="flex flex-col text-sm gap-1">Order Status
            <MultiSelect
              values={orderStatuses}
              onChange={setOrderStatuses}
              options={statusOptions}
              placeholder="All statuses"
            />
          </div>
          <div className="flex flex-col text-sm gap-1">Channel
            <SearchableSelect
              value={channel}
              onChange={(v) => {
                setChannel(v as HourlyFilters['channel']);
                setMarketplace('');
              }}
              options={[
                { value: 'both', label: 'Both' },
                { value: 'marketplace', label: 'Marketplaces only' },
                { value: 'ukss', label: 'UKSS only' },
              ]}
            />
          </div>
          {channel === 'marketplace' && (
            <div className="flex flex-col text-sm gap-1">Marketplace
              <SearchableSelect
                value={marketplace}
                onChange={setMarketplace}
                options={marketplaceOptions}
                allOption={{ value: '', label: 'All Marketplaces' }}
              />
            </div>
          )}
          <Button onClick={() => download.mutate(filters)} disabled={download.isPending}>
            Download CSV
          </Button>
        </CardContent>
      </Card>

      {(report.data ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Hourly comparison</CardTitle></CardHeader>
          <CardContent><HourlyComparisonChart rows={report.data!} /></CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {/* border + per-cell borders give a full grid (horizontal & vertical lines) */}
          <Table className="border-collapse border [&_th]:border [&_td]:border">
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                {HOURS.map((h) => (
                  <TableHead key={h} className="text-right">{h.slice(1)}</TableHead>
                ))}
                <TableHead className="text-right font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.isLoading && (
                <TableRow><TableCell colSpan={26}>Loading…</TableCell></TableRow>
              )}
              {!report.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={26}>No orders in range.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.day}>
                  <TableCell>{formatDay(row.day)}</TableCell>
                  {HOURS.map((h) => (
                    <TableCell key={h} className="text-right">{Number(row[h] ?? 0)}</TableCell>
                  ))}
                  <TableCell className="text-right font-bold">{row.total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell>Total</TableCell>
                  {hourTotals.map((t, i) => (
                    <TableCell key={i} className="text-right">{t}</TableCell>
                  ))}
                  <TableCell className="text-right">{grandTotal}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Today is in progress — the current day's not-yet-elapsed hours show 0.
        Range is limited to {MAX_RANGE_DAYS} days.
      </p>
    </div>
  );
}
