import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload, Loader2, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, getApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';


interface UploadSummary {
  totalRows: number;
  inserted: number;
  skippedInvalid: number;
  skippedNotInNpv: number;
  skippedDuplicates: number;
  failedInserts: number;
  offersCreated: number;
  offersFailed: number;
  processingTimeMs: number;
}

interface SkippedRow {
  row: number;
  sku: string;
  reason: string;
}

interface OfferError {
  ean: string;
  sku: string;
  error: string;
}

interface UploadResult {
  summary: UploadSummary;
  skippedRows: SkippedRow[];
  offerErrors: OfferError[];
  miraklImportIds: number[];
  downloadUrl: string;
}

interface ImportLog {
  id: number;
  filename: string;
  csvFilename: string | null;
  status: string;
  totalRows: number | null;
  inserted: number | null;
  skippedInvalid: number | null;
  skippedNotInNpv: number | null;
  skippedDuplicates: number | null;
  failedInserts: number | null;
  offersCreated: number | null;
  offersFailed: number | null;
  errorMessage: string | null;
  createdAt: string;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function SummaryCard({ label, value, variant = 'default' }: {
  label: string;
  value: number | string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}) {
  const colorMap = {
    default: 'text-foreground',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    error: 'text-red-600 dark:text-red-400',
  };

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={cn('text-2xl font-bold', colorMap[variant])}>{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

export function DebenhamsInventoryUploadPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const { data: importsData, isLoading: importsLoading } = useQuery({
    queryKey: ['debenhams-imports'],
    queryFn: async () => {
      const response = await api.get('/debenhams-inventory-upload/imports');
      return response.data;
    },
    staleTime: 30_000,
  });

  const imports: ImportLog[] = importsData?.data ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post<{ data: UploadResult }>(
        '/debenhams-inventory-upload/upload',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 300_000, // 5 minutes
        }
      );
      return response.data.data;
    },
    onSuccess: (result) => {
      setUploadResult(result);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['debenhams-imports'] });
      toast.success('Upload complete', {
        description: `Inserted ${result.summary.inserted.toLocaleString()} rows in ${formatMs(result.summary.processingTimeMs)}`,
      });
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error('Upload failed', { description: apiError.message });
    },
  });

  const validateAndSetFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Invalid file type', { description: 'Only .csv files are accepted.' });
      return;
    }
    setSelectedFile(file);
    setUploadResult(null);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploadMutation.isPending) setIsDragging(true);
  }, [uploadMutation.isPending]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploadMutation.isPending) return;

    const file = e.dataTransfer?.files?.[0];
    if (file) validateAndSetFile(file);
  }, [uploadMutation.isPending, validateAndSetFile]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
    if (inputRef.current) inputRef.current.value = '';
  }, [validateAndSetFile]);

  const handleUpload = () => {
    if (selectedFile) uploadMutation.mutate(selectedFile);
  };

  const isUploading = uploadMutation.isPending;

  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const handleDownloadCsv = async (downloadUrl: string) => {
    try {
      setDownloadingCsv(true);
      // Strip leading /api so the axios client (which already has /api base) doesn't double it
      const path = downloadUrl.replace(/^\/api/, '');
      const response = await api.get<Blob>(path, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = downloadUrl.split('/').pop() ?? 'debenhams_offers.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch {
      toast.error('Download failed', { description: 'Could not download the offers CSV.' });
    } finally {
      setDownloadingCsv(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Debenhams Delta Products Upload"
        description="Upload a CSV to add products to Debenhams (store 150) and create Mirakl offers"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Debenhams Upload' },
        ]}
        actions={
          <a
            href="/api/debenhams-inventory-upload/template"
            download="debenhams_upload_template.csv"
          >
            <Button variant="outline" type="button">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </a>
        }
      />

      {/* Upload Zone */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onClick={() => !isUploading && inputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50',
              isUploading && 'cursor-not-allowed opacity-60 pointer-events-none'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              disabled={isUploading}
            />
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium">
              {selectedFile ? selectedFile.name : 'Drop .csv here or click to select'}
            </p>
            <p className="text-xs text-muted-foreground">Only .csv files accepted</p>
          </div>

          {selectedFile && !isUploading && (
            <Button onClick={handleUpload} className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Upload &amp; Process
            </Button>
          )}

          {isUploading && (
            <div className="flex items-center justify-center gap-3 py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm font-medium">Processing&hellip; this may take 60&ndash;90 seconds</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {uploadResult && (
        <div className="space-y-6 mb-6">
          {/* DB Summary */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Database Summary</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard label="Total Rows" value={uploadResult.summary.totalRows} />
              <SummaryCard label="Inserted" value={uploadResult.summary.inserted} variant="success" />
              <SummaryCard label="Skipped (Invalid)" value={uploadResult.summary.skippedInvalid} variant="warning" />
              <SummaryCard label="Skipped (No NPV)" value={uploadResult.summary.skippedNotInNpv} variant="warning" />
              <SummaryCard label="Duplicates" value={uploadResult.summary.skippedDuplicates} variant="warning" />
              <SummaryCard label="Failed Inserts" value={uploadResult.summary.failedInserts} variant={uploadResult.summary.failedInserts > 0 ? 'error' : 'default'} />
            </div>
          </div>

          {/* Mirakl Summary */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Mirakl Offers Summary</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              <SummaryCard label="Offers Submitted" value={uploadResult.summary.inserted} />
              <SummaryCard label="Offers Created" value={uploadResult.summary.offersCreated} variant="success" />
              <SummaryCard label="Offers Failed" value={uploadResult.summary.offersFailed} variant={uploadResult.summary.offersFailed > 0 ? 'error' : 'default'} />
              <SummaryCard label="Processing Time" value={formatMs(uploadResult.summary.processingTimeMs)} />
            </div>
            {uploadResult.miraklImportIds.length > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Mirakl Import ID{uploadResult.miraklImportIds.length > 1 ? 's' : ''}: {uploadResult.miraklImportIds.join(', ')}
              </p>
            )}
          </div>

          {/* Download CSV — programmatic fetch so axios sends the JWT Authorization header */}
          <div>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleDownloadCsv(uploadResult.downloadUrl)}
              disabled={downloadingCsv}
            >
              {downloadingCsv
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Downloading…</>
                : <><Download className="h-4 w-4 mr-2" />Download Offers CSV</>
              }
            </Button>
          </div>

          {/* Skipped Rows */}
          {uploadResult.skippedRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Skipped Rows
                  {uploadResult.skippedRows.length === 1000 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">(1000 shown)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploadResult.skippedRows.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-muted-foreground">{row.row}</TableCell>
                          <TableCell className="font-mono text-xs">{row.sku || <span className="text-muted-foreground italic">empty</span>}</TableCell>
                          <TableCell>{row.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Offer Errors */}
          {uploadResult.offerErrors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Offer Errors
                  {uploadResult.offerErrors.length === 1000 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">(1000 shown)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>EAN</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploadResult.offerErrors.map((err, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono text-xs">{err.ean}</TableCell>
                          <TableCell className="font-mono text-xs">{err.sku}</TableCell>
                          <TableCell className="text-red-600 dark:text-red-400">{err.error}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recent Imports */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Imports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {importsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : imports.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Inserted</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Offers Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-sm font-mono max-w-xs truncate" title={log.filename}>
                      {log.filename}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          log.status === 'complete'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                        )}
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {log.totalRows?.toLocaleString() ?? '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {log.inserted?.toLocaleString() ?? '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {log.skippedInvalid != null && log.skippedNotInNpv != null && log.skippedDuplicates != null
                        ? (log.skippedInvalid + log.skippedNotInNpv + log.skippedDuplicates).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {log.offersCreated?.toLocaleString() ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
