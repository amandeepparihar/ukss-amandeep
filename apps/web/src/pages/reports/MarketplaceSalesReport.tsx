import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useOrderStatuses } from './hooks/useHourlyReport';
import { useMarketplaceSales, useDownloadMarketplaceCsv, type MsFilters } from './hooks/useMarketplaceSales';
import { MarketplaceCharts } from './MarketplaceCharts';

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function MarketplaceSalesReport() {
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(29));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));
  const [channel, setChannel] = useState<MsFilters['channel']>('both');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[] | null>(null); // null = default top-6

  const statusQ = useOrderStatuses();
  const statusOptions = useMemo(
    () => (statusQ.data ?? []).map((s) => ({ value: String(s.id), label: s.name })), [statusQ.data]);

  const filters: MsFilters = { dateFrom, dateTo, channel, statuses };
  const { data, isLoading } = useMarketplaceSales(filters);
  const download = useDownloadMarketplaceCsv();

  const breakdown = data?.breakdown ?? [];
  const labels = useMemo(
    () => Object.fromEntries(breakdown.map((b) => [b.orderSite, b.channel])), [breakdown]);
  // default plotted channels = top 6 by orders; otherwise user's Compare selection
  const top6 = useMemo(
    () => [...breakdown].sort((a, b) => b.orders - a.orders).slice(0, 6).map((b) => b.orderSite),
    [breakdown]);
  const selected = compare ?? top6;
  const compareOptions = breakdown.map((b) => ({ value: b.orderSite, label: b.channel }));

  const totals = useMemo(() => ({
    orders: breakdown.reduce((s, b) => s + b.orders, 0),
    revenue: breakdown.reduce((s, b) => s + b.revenue, 0),
  }), [breakdown]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm gap-1">From
            <input type="date" value={dateFrom} max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col text-sm gap-1">To
            <input type="date" value={dateTo} min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <div className="flex flex-col text-sm gap-1">Channel
            <SearchableSelect value={channel} onChange={(v) => setChannel(v as MsFilters['channel'])}
              options={[
                { value: 'both', label: 'Both' },
                { value: 'marketplace', label: 'Marketplaces only' },
                { value: 'ukss', label: 'UKSS only' },
              ]} />
          </div>
          <div className="flex flex-col text-sm gap-1">Order Status
            <MultiSelect values={statuses} onChange={setStatuses} options={statusOptions} placeholder="All statuses" />
          </div>
          <Button onClick={() => download.mutate(filters)} disabled={download.isPending}>Download CSV</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="border-collapse border [&_th]:border [&_td]:border">
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">AOV</TableHead>
                <TableHead className="text-right">% Share</TableHead>
                <TableHead className="text-right">vs Prev</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>}
              {!isLoading && breakdown.length === 0 && (
                <TableRow><TableCell colSpan={6}>No orders in range.</TableCell></TableRow>
              )}
              {breakdown.map((b) => (
                <TableRow key={b.orderSite}>
                  <TableCell>{b.channel}</TableCell>
                  <TableCell className="text-right">{b.orders}</TableCell>
                  <TableCell className="text-right">{gbp(b.revenue)}</TableCell>
                  <TableCell className="text-right">{gbp(b.aov)}</TableCell>
                  <TableCell className="text-right">{b.sharePercent}%</TableCell>
                  <TableCell className="text-right">{b.vsPrevPercent === null ? '—' : `${b.vsPrevPercent > 0 ? '▲' : '▼'} ${b.vsPrevPercent}%`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {breakdown.length > 0 && (
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{totals.orders}</TableCell>
                  <TableCell className="text-right">{gbp(totals.revenue)}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {breakdown.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base">Trends</CardTitle>
            <div className="text-sm">Compare
              <MultiSelect className="ml-2 inline-flex"
                values={selected} onChange={setCompare} options={compareOptions} placeholder="Channels" />
            </div>
          </CardHeader>
          <CardContent>
            <MarketplaceCharts breakdown={breakdown} daily={data!.dailyTrend} hourly={data!.hourly} labels={labels} selected={selected} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
