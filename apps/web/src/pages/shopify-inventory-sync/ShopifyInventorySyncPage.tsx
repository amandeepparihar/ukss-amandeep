import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw, FileText, Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api, getApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

// ============ Types ============

interface StoreInfo {
  storeId: number;
  storeName: string;
  hasExportFile: boolean;
  fileName?: string;
  fileModified?: string;
}

interface MismatchRow {
  productId: number;
  variantId: number;
  excelQty: number;
  dbQty: number;
  diff: number;
}

interface CompareResult {
  storeId: number;
  storeName: string;
  fileName: string;
  totalExcelRows: number;
  matched: number;
  skipped: number;
  mismatches: MismatchRow[];
  notFound: Array<{ productId: number; variantId: number }>;
  processingTimeMs: number;
}

interface ApplyResult {
  updated: number;
  failed: number;
  errors: Array<{ variantId: number; error: string }>;
  processingTimeMs: number;
}

// ============ Helpers ============

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
        <p className={cn('text-2xl font-bold', colorMap[variant])}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      </CardContent>
    </Card>
  );
}

// ============ Page ============

export function ShopifyInventorySyncPage() {
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [showNotFound, setShowNotFound] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Fetch stores
  const { data: storesData, isLoading: storesLoading } = useQuery({
    queryKey: ['shopify-inventory-sync-stores'],
    queryFn: async () => {
      const res = await api.get('/shopify-inventory-sync/stores');
      return res.data;
    },
    staleTime: 60_000,
  });
  const stores: StoreInfo[] = storesData?.data ?? [];
  const selectedStore = stores.find((s) => String(s.storeId) === selectedStoreId);

  // Compare mutation
  const compareMutation = useMutation({
    mutationFn: async (storeId: number) => {
      const res = await api.post<{ data: CompareResult }>(
        '/shopify-inventory-sync/compare',
        { storeId },
        { timeout: 300_000 },
      );
      return res.data.data;
    },
    onSuccess: (result) => {
      setCompareResult(result);
      setApplyResult(null);
      if (result.mismatches.length === 0) {
        toast.success('No mismatches found', {
          description: `All ${result.matched.toLocaleString()} variants match.`,
        });
      } else {
        toast.info('Comparison complete', {
          description: `Found ${result.mismatches.length.toLocaleString()} mismatches in ${formatMs(result.processingTimeMs)}`,
        });
      }
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error('Compare failed', { description: apiError.message });
    },
  });

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: async (data: { storeId: number; updates: Array<{ variantId: number; newQty: number }> }) => {
      const res = await api.post<{ data: ApplyResult }>(
        '/shopify-inventory-sync/apply',
        data,
        { timeout: 300_000 },
      );
      return res.data.data;
    },
    onSuccess: (result) => {
      setApplyResult(result);
      if (result.failed === 0) {
        toast.success('Updates applied', {
          description: `Updated ${result.updated.toLocaleString()} variants in ${formatMs(result.processingTimeMs)}`,
        });
      } else {
        toast.warning('Updates partially applied', {
          description: `Updated ${result.updated.toLocaleString()}, failed ${result.failed.toLocaleString()}`,
        });
      }
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error('Update failed', { description: apiError.message });
    },
  });

  const handleCompare = () => {
    if (!selectedStoreId) return;
    setCompareResult(null);
    setApplyResult(null);
    setShowNotFound(false);
    compareMutation.mutate(Number(selectedStoreId));
  };

  const handleApply = () => {
    if (!compareResult || !selectedStoreId) return;
    const updates = compareResult.mismatches.map((m) => ({
      variantId: m.variantId,
      newQty: m.excelQty,
    }));
    applyMutation.mutate({ storeId: Number(selectedStoreId), updates });
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ storeId, file }: { storeId: number; file: File }) => {
      const formData = new FormData();
      formData.append('storeId', String(storeId));
      formData.append('file', file);
      const res = await api.post<{ data: CompareResult }>(
        '/shopify-inventory-sync/upload',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300_000 },
      );
      return res.data.data;
    },
    onSuccess: (result) => {
      setCompareResult(result);
      setApplyResult(null);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['shopify-inventory-sync-stores'] });
      if (result.mismatches.length === 0) {
        toast.success('No mismatches found', {
          description: `All ${result.matched.toLocaleString()} variants match.`,
        });
      } else {
        toast.info('Upload & comparison complete', {
          description: `Found ${result.mismatches.length.toLocaleString()} mismatches in ${formatMs(result.processingTimeMs)}`,
        });
      }
    },
    onError: (error: unknown) => {
      const apiError = getApiError(error);
      toast.error('Upload failed', { description: apiError.message });
    },
  });

  const validateAndSetFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Invalid file type', { description: 'Only .xlsx files are accepted.' });
      return;
    }
    setSelectedFile(file);
    setCompareResult(null);
    setApplyResult(null);
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
    if (selectedFile && selectedStoreId) {
      uploadMutation.mutate({ storeId: Number(selectedStoreId), file: selectedFile });
    }
  };

  const isComparing = compareMutation.isPending;
  const isApplying = applyMutation.isPending;
  const isUploading = uploadMutation.isPending;

  return (
    <div>
      <PageHeader
        title="Shopify Inventory Sync"
        description="Compare Matrixify export quantities against the database and fix mismatches"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Shopify Inv. Sync' },
        ]}
      />

      {/* Store Selection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Store</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {storesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stores...
            </div>
          ) : (
            <>
              <Select value={selectedStoreId} onValueChange={(val) => { setSelectedStoreId(val); setCompareResult(null); setApplyResult(null); }}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Choose a Shopify store..." />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem
                      key={store.storeId}
                      value={String(store.storeId)}
                    >
                      {store.storeName}{!store.hasExportFile ? ' (No server file)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedStore?.hasExportFile && (
                <div className="text-sm text-muted-foreground">
                  File: <span className="font-mono">{selectedStore.fileName}</span>
                  {selectedStore.fileModified && (
                    <> &middot; Modified: {new Date(selectedStore.fileModified).toLocaleString()}</>
                  )}
                </div>
              )}

              <Button
                onClick={handleCompare}
                disabled={!selectedStoreId || !selectedStore?.hasExportFile || isComparing || isUploading}
              >
                {isComparing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Compare Server File
                  </>
                )}
              </Button>

              {/* Divider */}
              {selectedStoreId && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">OR upload a file</span>
                  <div className="flex-1 border-t" />
                </div>
              )}

              {/* Upload Zone */}
              {selectedStoreId && (
                <>
                  <div
                    onClick={() => !isUploading && inputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                      'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
                      isDragging
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-muted-foreground/50',
                      isUploading && 'cursor-not-allowed opacity-60 pointer-events-none'
                    )}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".xlsx"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isUploading}
                    />
                    <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="mb-1 text-sm font-medium">
                      {selectedFile ? selectedFile.name : 'Drop .xlsx here or click to select'}
                    </p>
                    <p className="text-xs text-muted-foreground">Only .xlsx files accepted (max 50MB)</p>
                  </div>

                  {selectedFile && !isUploading && (
                    <Button onClick={handleUpload} className="w-full">
                      <Upload className="h-4 w-4 mr-2" />
                      Upload &amp; Compare
                    </Button>
                  )}

                  {isUploading && (
                    <div className="flex items-center justify-center gap-3 py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-sm font-medium">Uploading &amp; comparing&hellip; this may take a moment</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Compare Results */}
      {compareResult && !applyResult && (
        <div className="space-y-6 mb-6">
          {/* Store + File Info */}
          <div className="text-sm text-muted-foreground">
            Store: <strong>{compareResult.storeName}</strong> &middot; File: <span className="font-mono">{compareResult.fileName}</span>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="Total Rows" value={compareResult.totalExcelRows} />
            <SummaryCard label="Matched" value={compareResult.matched} variant="success" />
            <SummaryCard label="Mismatches" value={compareResult.mismatches.length} variant={compareResult.mismatches.length > 0 ? 'error' : 'default'} />
            <SummaryCard label="Not Found" value={compareResult.notFound.length} variant={compareResult.notFound.length > 0 ? 'warning' : 'default'} />
            <SummaryCard label="Skipped" value={compareResult.skipped} variant={compareResult.skipped > 0 ? 'warning' : 'default'} />
            <SummaryCard label="Processing Time" value={formatMs(compareResult.processingTimeMs)} />
          </div>

          {/* No mismatches message */}
          {compareResult.mismatches.length === 0 && compareResult.totalExcelRows > 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                All quantities match. No updates needed.
              </CardContent>
            </Card>
          )}

          {/* No data message */}
          {compareResult.totalExcelRows === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No data rows found in the export file.
              </CardContent>
            </Card>
          )}

          {/* Mismatch Table */}
          {compareResult.mismatches.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Mismatches
                  <Badge variant="secondary" className="ml-2">{compareResult.mismatches.length.toLocaleString()}</Badge>
                </CardTitle>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={isApplying}>
                      {isApplying ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying...</>
                      ) : (
                        'Apply Updates'
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Inventory Update</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will update <strong>{compareResult.mismatches.length.toLocaleString()}</strong> variant
                        quantities in the database for store <strong>{compareResult.storeName}</strong>.
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleApply}>Confirm Update</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product ID</TableHead>
                        <TableHead>Variant ID</TableHead>
                        <TableHead className="text-right">DB Qty</TableHead>
                        <TableHead className="text-right">Excel Qty</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compareResult.mismatches.map((row) => (
                        <TableRow key={row.variantId}>
                          <TableCell className="font-mono text-xs">{row.productId}</TableCell>
                          <TableCell className="font-mono text-xs">{row.variantId}</TableCell>
                          <TableCell className="text-right">{row.dbQty.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.excelQty.toLocaleString()}</TableCell>
                          <TableCell className={cn(
                            'text-right font-medium',
                            row.diff > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
                          )}>
                            {row.diff > 0 ? '+' : ''}{row.diff.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Not Found Section */}
          {compareResult.notFound.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle
                  className="text-base cursor-pointer select-none"
                  onClick={() => setShowNotFound(!showNotFound)}
                >
                  Not Found in DB
                  <Badge variant="secondary" className="ml-2">{compareResult.notFound.length.toLocaleString()}</Badge>
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {showNotFound ? '(click to collapse)' : '(click to expand)'}
                  </span>
                </CardTitle>
              </CardHeader>
              {showNotFound && (
                <CardContent className="p-0">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product ID</TableHead>
                          <TableHead>Variant ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {compareResult.notFound.slice(0, 1000).map((row) => (
                          <TableRow key={row.variantId}>
                            <TableCell className="font-mono text-xs">{row.productId}</TableCell>
                            <TableCell className="font-mono text-xs">{row.variantId}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {compareResult.notFound.length > 1000 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Showing 1000 of {compareResult.notFound.length.toLocaleString()}
                      </p>
                    )}
                  </ScrollArea>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Apply Results */}
      {applyResult && (
        <div className="space-y-6 mb-6">
          <h2 className="text-lg font-semibold">Update Results</h2>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            <SummaryCard label="Updated" value={applyResult.updated} variant="success" />
            <SummaryCard label="Failed" value={applyResult.failed} variant={applyResult.failed > 0 ? 'error' : 'default'} />
            <SummaryCard label="Processing Time" value={formatMs(applyResult.processingTimeMs)} />
          </div>

          {applyResult.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Errors</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variant ID</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {applyResult.errors.slice(0, 1000).map((err, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{err.variantId}</TableCell>
                          <TableCell className="text-red-600 dark:text-red-400">{err.error}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Button variant="outline" onClick={handleCompare}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Re-run Compare
          </Button>
        </div>
      )}
    </div>
  );
}
