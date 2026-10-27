import { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Eye,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  FileJson,
  Table2,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface ReportColumn {
  key: string;
  label: string;
  format?: 'string' | 'number' | 'date' | 'currency' | 'boolean';
}

interface ReportFilter {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: Array<{ value: string; label: string }>;
}

interface Report {
  id: string;
  name: string;
  description?: string;
  dataSource: string;
  columns: ReportColumn[];
  filters?: ReportFilter[];
  defaultSort?: { column: string; direction: 'asc' | 'desc' };
}

interface ReportStats {
  totalReports: number;
  availableDataSources: string[];
}

export function ReportsDemo() {
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Fetch reports
  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const [reportsRes, statsRes] = await Promise.all([
        api.get('/reports'),
        api.get('/reports/stats'),
      ]);
      setReports(reportsRes.data.data);
      setStats(statsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  // Preview report
  const previewReport = async (report: Report) => {
    setSelectedReport(report);
    setPreviewDialogOpen(true);
    setPreviewLoading(true);
    setFilterValues({});
    try {
      const response = await api.post(`/reports/${report.id}/preview`, {
        params: {},
      });
      setPreviewData(response.data.data.preview || []);
    } catch (error) {
      console.error('Failed to preview report:', error);
      toast.error('Failed to generate preview');
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Apply filters to preview
  const applyFilters = async () => {
    if (!selectedReport) return;
    setPreviewLoading(true);
    try {
      const response = await api.post(`/reports/${selectedReport.id}/preview`, {
        params: filterValues,
      });
      setPreviewData(response.data.data.preview || []);
      toast.success(`Showing ${response.data.data.preview?.length || 0} of ${response.data.data.totalRows} rows`);
    } catch (error) {
      toast.error('Failed to apply filters');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Download report
  const downloadReport = async (report: Report, format: 'csv' | 'json' | 'excel') => {
    setDownloadingFormat(format);
    try {
      const response = await api.post(
        `/reports/${report.id}/generate`,
        {
          reportId: report.id,
          format,
          params: filterValues,
        },
        {
          responseType: 'blob',
        }
      );

      // Create download link
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${report.name.replace(/\s+/g, '-').toLowerCase()}_${timestamp}`;
      link.download = `${filename}.${format === 'excel' ? 'xls' : format}`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`${report.name} exported as ${format.toUpperCase()}`);
    } catch (error) {
      toast.error('Failed to download report');
    } finally {
      setDownloadingFormat(null);
    }
  };

  const formatCellValue = (value: unknown, format?: string) => {
    if (value === null || value === undefined) return '-';

    switch (format) {
      case 'date':
        return new Date(value as string).toLocaleString();
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(value as number);
      case 'number':
        return (value as number).toLocaleString();
      case 'boolean':
        return value ? 'Yes' : 'No';
      default:
        return String(value);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">
            Generate and download reports in CSV, JSON, or Excel format.
          </p>
        </div>
        <Button onClick={fetchReports} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="reports" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reports">Available Reports</TabsTrigger>
          <TabsTrigger value="datasources">Data Sources</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-4">
          {/* Stats */}
          {stats && (
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Reports
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">{stats.totalReports}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Data Sources
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Table2 className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">
                      {stats.availableDataSources.length}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Export Formats
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Download className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">3</span>
                    <span className="text-sm text-muted-foreground">(CSV, JSON, Excel)</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Reports Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No reports available
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {reports.map((report) => (
                <Card key={report.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{report.name}</CardTitle>
                        {report.description && (
                          <CardDescription className="mt-1">
                            {report.description}
                          </CardDescription>
                        )}
                      </div>
                      <Badge variant="outline">{report.dataSource}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Columns</p>
                        <div className="flex flex-wrap gap-1">
                          {report.columns.slice(0, 4).map((col) => (
                            <Badge key={col.key} variant="secondary" className="text-xs">
                              {col.label}
                            </Badge>
                          ))}
                          {report.columns.length > 4 && (
                            <Badge variant="secondary" className="text-xs">
                              +{report.columns.length - 4} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      {report.filters && report.filters.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Filters</p>
                          <div className="flex flex-wrap gap-1">
                            {report.filters.map((filter) => (
                              <Badge key={filter.key} variant="outline" className="text-xs">
                                <Filter className="h-3 w-3 mr-1" />
                                {filter.label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <div className="p-4 pt-0 mt-auto">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => previewReport(report)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => downloadReport(report, 'csv')}
                        disabled={downloadingFormat !== null}
                      >
                        {downloadingFormat === 'csv' ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-1" />
                        )}
                        CSV
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="datasources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Available Data Sources</CardTitle>
              <CardDescription>
                Data sources that can be used when creating custom reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats?.availableDataSources && stats.availableDataSources.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {stats.availableDataSources.map((source) => (
                    <Card key={source}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                          <Table2 className="h-5 w-5 text-primary" />
                          <code className="text-sm font-mono">{source}</code>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No data sources registered</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Built-in Data Sources</CardTitle>
              <CardDescription>
                Pre-configured data sources for common reporting needs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data Source</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Filters Supported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">user-activity</code>
                    </TableCell>
                    <TableCell>User login counts and activity statistics</TableCell>
                    <TableCell>Date range</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">audit-logs</code>
                    </TableCell>
                    <TableCell>System audit trail with user actions</TableCell>
                    <TableCell>Date range, Action, Resource</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">users</code>
                    </TableCell>
                    <TableCell>User directory with roles and status</TableCell>
                    <TableCell>Active status, Role</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">login-history</code>
                    </TableCell>
                    <TableCell>Authentication attempts and details</TableCell>
                    <TableCell>Date range, Success/Failure</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">active-sessions</code>
                    </TableCell>
                    <TableCell>Currently active user sessions</TableCell>
                    <TableCell>None</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Reports API Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`# List available reports
GET /api/reports

# Get report statistics
GET /api/reports/stats

# Get a specific report definition
GET /api/reports/:reportId

# Preview report data (first 100 rows)
POST /api/reports/:reportId/preview
Body: {
  "params": {
    "dateFrom": "2024-01-01",
    "dateTo": "2024-12-31"
  }
}

# Generate and download report
POST /api/reports/:reportId/generate
Body: {
  "reportId": "user-activity",
  "format": "csv" | "json" | "excel",
  "params": {
    "dateFrom": "2024-01-01",
    "dateTo": "2024-12-31"
  }
}
Response: File download (streamed)

# List available data sources
GET /api/reports/data-sources`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Creating Custom Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/modules/reports/reports.service.ts

// Register a custom data source
reportsService.registerDataSource('custom-sales', async (params) => {
  const { dateFrom, dateTo, region } = params;

  const sales = await prisma.sale.findMany({
    where: {
      createdAt: {
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
      region: region || undefined,
    },
    include: {
      customer: true,
      product: true,
    },
  });

  return sales.map(sale => ({
    orderId: sale.id,
    date: sale.createdAt,
    customer: sale.customer.name,
    product: sale.product.name,
    quantity: sale.quantity,
    total: sale.total,
    region: sale.region,
  }));
});

// Register the report definition
reportsService.registerReport({
  id: 'sales-report',
  name: 'Sales Report',
  description: 'Detailed sales transactions',
  dataSource: 'custom-sales',
  columns: [
    { key: 'orderId', label: 'Order ID' },
    { key: 'date', label: 'Date', format: 'date' },
    { key: 'customer', label: 'Customer' },
    { key: 'product', label: 'Product' },
    { key: 'quantity', label: 'Qty', format: 'number' },
    { key: 'total', label: 'Total', format: 'currency' },
    { key: 'region', label: 'Region' },
  ],
  filters: [
    { key: 'dateFrom', label: 'From Date', type: 'date' },
    { key: 'dateTo', label: 'To Date', type: 'date' },
    { key: 'region', label: 'Region', type: 'select', options: [
      { value: 'north', label: 'North' },
      { value: 'south', label: 'South' },
    ]},
  ],
  defaultSort: { column: 'date', direction: 'desc' },
});`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{selectedReport?.name}</DialogTitle>
            <DialogDescription>
              {selectedReport?.description || 'Preview report data before downloading'}
            </DialogDescription>
          </DialogHeader>

          {/* Filters */}
          {selectedReport?.filters && selectedReport.filters.length > 0 && (
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between"
                onClick={() => setFiltersExpanded(!filtersExpanded)}
              >
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </div>
                {filtersExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {filtersExpanded && (
                <div className="pt-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    {selectedReport.filters.map((filter) => (
                      <div key={filter.key} className="space-y-2">
                        <Label>{filter.label}</Label>
                        {filter.type === 'date' ? (
                          <Input
                            type="date"
                            value={filterValues[filter.key] || ''}
                            onChange={(e) =>
                              setFilterValues((prev) => ({
                                ...prev,
                                [filter.key]: e.target.value,
                              }))
                            }
                          />
                        ) : filter.type === 'select' && filter.options ? (
                          <Select
                            value={filterValues[filter.key] || ''}
                            onValueChange={(value) =>
                              setFilterValues((prev) => ({
                                ...prev,
                                [filter.key]: value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {filter.options.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={filter.type === 'number' ? 'number' : 'text'}
                            value={filterValues[filter.key] || ''}
                            onChange={(e) =>
                              setFilterValues((prev) => ({
                                ...prev,
                                [filter.key]: e.target.value,
                              }))
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={applyFilters}
                    className="mt-4"
                    disabled={previewLoading}
                  >
                    {previewLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Filter className="h-4 w-4 mr-2" />
                    )}
                    Apply Filters
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Preview Table */}
          <ScrollArea className="h-[400px] border rounded-md">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No data available
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectedReport?.columns.map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.map((row, idx) => (
                    <TableRow key={idx}>
                      {selectedReport?.columns.map((col) => (
                        <TableCell key={col.key} className="text-sm">
                          {formatCellValue(row[col.key], col.format)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => selectedReport && downloadReport(selectedReport, 'csv')}
                disabled={downloadingFormat !== null}
              >
                {downloadingFormat === 'csv' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => selectedReport && downloadReport(selectedReport, 'json')}
                disabled={downloadingFormat !== null}
              >
                {downloadingFormat === 'json' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileJson className="h-4 w-4 mr-2" />
                )}
                JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => selectedReport && downloadReport(selectedReport, 'excel')}
                disabled={downloadingFormat !== null}
              >
                {downloadingFormat === 'excel' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                )}
                Excel
              </Button>
            </div>
            <Button variant="secondary" onClick={() => setPreviewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
