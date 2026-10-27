import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Save, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/components/ui/alert-dialog';
import { api, getApiError } from '@/lib/api';

// refs: #165290 - orders_products.fc_batch_id is MySQL INT(11) signed.
const INT11_SIGNED_MAX = 2147483647;

function validateFcBatchId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'FC Batch ID is required';
  if (!/^\d+$/.test(trimmed)) return 'Please enter a valid Batch ID (integer)';
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1 || n > INT11_SIGNED_MAX) {
    return `Please enter a valid Batch ID between 1 and ${INT11_SIGNED_MAX}`;
  }
  return null;
}

interface ToteProduct {
  ordersProductsId: number;
  ordersId: number;
  productsId: number;
  name: string;
  model: string | null;
  barcode: string | null;
  quantity: number;
  fcOrderId: string | null;
  fcBatchId: string | null;
  fcToteId: string | null;
  multipartBatchId: number | null;
  multipartToteId: string | null;
}

interface OrderLookupData {
  ordersId: number;
  ordersStatus: number;
  fcOrderId: string | null;
  products: ToteProduct[];
}

interface BatchLookupData {
  mfoId: number;
  fcBatchName: string;
  products: ToteProduct[];
}

export function ToteAssignmentPage() {
  return (
    <div>
      <PageHeader
        title="TOTE Assignment"
        description="Assign FC / Multipart TOTE IDs to order products or FC batches"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'TOTE Assignment' },
        ]}
      />

      <Tabs defaultValue="order" className="mt-4">
        <TabsList>
          <TabsTrigger value="order">By Order ID</TabsTrigger>
          <TabsTrigger value="batch">By Batch Name</TabsTrigger>
        </TabsList>
        <TabsContent value="order" className="mt-4">
          <OrderFlow />
        </TabsContent>
        <TabsContent value="batch" className="mt-4">
          <BatchFlow />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrderFlow() {
  const [orderIdInput, setOrderIdInput] = useState('');
  const [orderData, setOrderData] = useState<OrderLookupData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [fcBatchId, setFcBatchId] = useState('');
  const [fcToteId, setFcToteId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [overwriteMsg, setOverwriteMsg] = useState('');

  // FC Order ID is read-only — always comes from the `orders` table.
  // Coerce to string defensively in case Prisma returns a numeric column.
  const fcOrderIdFromDb = orderData?.fcOrderId != null ? String(orderData.fcOrderId) : '';

  const fetchMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await api.get(`/tote-assignment/order/${orderId}`);
      return response.data.data as OrderLookupData;
    },
    onSuccess: (data) => {
      setOrderData(data);
      setSelectedIds(new Set());
      setFcBatchId('');
      setFcToteId('');
    },
    onError: (error) => {
      setOrderData(null);
      toast.error(getApiError(error).message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/tote-assignment/order', {
        ordersId: orderData!.ordersId,
        ordersProductsIds: Array.from(selectedIds),
        fcOrderId: fcOrderIdFromDb,
        fcBatchId: fcBatchId.trim(),
        fcToteId: fcToteId.trim(),
      });
      return response.data;
    },
    onSuccess: (res) => {
      toast.success(`${res.message} (${res.data.updatedCount} row(s) updated)`);
      if (orderData) {
        fetchMutation.mutate(String(orderData.ordersId));
      }
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
    onSettled: () => {
      setConfirmOpen(false);
    },
  });

  const handleFetch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = orderIdInput.trim();
    if (!trimmed) {
      toast.error('Enter an Order ID');
      return;
    }
    fetchMutation.mutate(trimmed);
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!orderData) return;
    setSelectedIds((prev) => {
      if (prev.size === orderData.products.length) return new Set();
      return new Set(orderData.products.map((p) => p.ordersProductsId));
    });
  };

  const attemptSave = () => {
    if (!orderData) return;
    if (selectedIds.size === 0) {
      toast.error('Select at least one product');
      return;
    }
    if (!fcOrderIdFromDb) {
      toast.error('This order has no FC Order ID set. Cannot assign TOTE — order has not been sent to FC yet.');
      return;
    }
    if (!fcBatchId.trim() || !fcToteId.trim()) {
      toast.error('FC Batch ID and FC Tote ID are required');
      return;
    }
    const batchIdError = validateFcBatchId(fcBatchId);
    if (batchIdError) {
      toast.error(batchIdError);
      return;
    }

    const overwritten = orderData.products.filter(
      (p) =>
        selectedIds.has(p.ordersProductsId) &&
        (p.fcToteId || p.fcBatchId || p.fcOrderId),
    );

    if (overwritten.length > 0) {
      const lines = overwritten
        .map(
          (p) =>
            `• opid ${p.ordersProductsId}: tote "${p.fcToteId ?? ''}", batch "${p.fcBatchId ?? ''}", fc_order "${p.fcOrderId ?? ''}"`,
        )
        .join('\n');
      setOverwriteMsg(
        `${overwritten.length} selected product(s) already have FC values set. Saving will overwrite them:\n\n${lines}`,
      );
      setConfirmOpen(true);
      return;
    }

    saveMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign TOTE by Order ID</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleFetch} className="flex items-end gap-2">
          <div className="flex-1 max-w-xs">
            <Label htmlFor="order-id-input">Order ID</Label>
            <Input
              id="order-id-input"
              type="number"
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value)}
              placeholder="e.g. 1969131"
            />
          </div>
          <Button type="submit" loading={fetchMutation.isPending}>
            <Search className="h-4 w-4 mr-2" />
            Fetch
          </Button>
        </form>

        {orderData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
              <div>
                <Label htmlFor="fc-order-id">FC Order ID</Label>
                <Input
                  id="fc-order-id"
                  value={fcOrderIdFromDb}
                  readOnly
                  disabled
                  placeholder="—"
                />
                {!fcOrderIdFromDb && (
                  <p className="text-xs text-destructive mt-1">
                    Not set on order — cannot assign TOTE
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="fc-batch-id">FC Batch ID</Label>
                <Input
                  id="fc-batch-id"
                  value={fcBatchId}
                  onChange={(e) => setFcBatchId(e.target.value)}
                  placeholder="FC Batch ID"
                />
              </div>
              <div>
                <Label htmlFor="fc-tote-id">FC Tote ID</Label>
                <Input
                  id="fc-tote-id"
                  value={fcToteId}
                  onChange={(e) => setFcToteId(e.target.value)}
                  placeholder="FC Tote ID"
                />
              </div>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          orderData.products.length > 0 &&
                          selectedIds.size === orderData.products.length
                        }
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>OP ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Current FC Tote</TableHead>
                    <TableHead>Current FC Batch</TableHead>
                    <TableHead>Current FC Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderData.products.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                        No products found for this order
                      </TableCell>
                    </TableRow>
                  )}
                  {orderData.products.map((p) => {
                    const hasExisting = p.fcToteId || p.fcBatchId || p.fcOrderId;
                    return (
                      <TableRow key={p.ordersProductsId}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(p.ordersProductsId)}
                            onCheckedChange={() => toggleRow(p.ordersProductsId)}
                            aria-label={`Select product ${p.ordersProductsId}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.ordersProductsId}
                          {hasExisting && (
                            <AlertTriangle
                              className="inline h-3 w-3 text-amber-500 ml-1"
                              aria-label="Already assigned"
                            />
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{p.name}</TableCell>
                        <TableCell className="font-mono text-xs">{p.model ?? '—'}</TableCell>
                        <TableCell className="text-right">{p.quantity}</TableCell>
                        <TableCell className="font-mono text-xs">{p.fcToteId ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.fcBatchId ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.fcOrderId ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={attemptSave}
                loading={saveMutation.isPending}
                disabled={selectedIds.size === 0 || !fcOrderIdFromDb}
              >
                <Save className="h-4 w-4 mr-2" />
                Save TOTE ({selectedIds.size} selected)
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite existing TOTE values?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap font-mono text-xs">
              {overwriteMsg}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveMutation.mutate()}>
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function BatchFlow() {
  const [batchNameInput, setBatchNameInput] = useState('');
  const [batchData, setBatchData] = useState<BatchLookupData | null>(null);
  const [multipartToteId, setMultipartToteId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchMutation = useMutation({
    mutationFn: async (batchName: string) => {
      const response = await api.get(
        `/tote-assignment/batch/${encodeURIComponent(batchName)}`,
      );
      return response.data.data as BatchLookupData;
    },
    onSuccess: (data) => {
      setBatchData(data);
      setMultipartToteId('');
    },
    onError: (error) => {
      setBatchData(null);
      toast.error(getApiError(error).message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/tote-assignment/batch', {
        mfoId: batchData!.mfoId,
        multipartToteId: multipartToteId.trim(),
      });
      return response.data;
    },
    onSuccess: (res) => {
      toast.success(`${res.message} (${res.data.updatedCount} row(s) updated)`);
      if (batchData) {
        fetchMutation.mutate(batchData.fcBatchName);
      }
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
    onSettled: () => {
      setConfirmOpen(false);
    },
  });

  const handleFetch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = batchNameInput.trim();
    if (!trimmed) {
      toast.error('Enter a batch name');
      return;
    }
    fetchMutation.mutate(trimmed);
  };

  const attemptSave = () => {
    if (!batchData) return;
    if (!multipartToteId.trim()) {
      toast.error('Multipart Tote ID is required');
      return;
    }
    const overwriting = batchData.products.some((p) => p.multipartToteId);
    if (overwriting) {
      setConfirmOpen(true);
      return;
    }
    saveMutation.mutate();
  };

  const overwriteCount = batchData?.products.filter((p) => p.multipartToteId).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign Multipart TOTE by Batch Name</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleFetch} className="flex items-end gap-2">
          <div className="flex-1 max-w-xs">
            <Label htmlFor="batch-name-input">FC Batch Name</Label>
            <Input
              id="batch-name-input"
              value={batchNameInput}
              onChange={(e) => setBatchNameInput(e.target.value)}
              placeholder="e.g. 10042026-1"
            />
          </div>
          <Button type="submit" loading={fetchMutation.isPending}>
            <Search className="h-4 w-4 mr-2" />
            Fetch
          </Button>
        </form>

        {batchData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
              <div>
                <Label>Batch Name</Label>
                <div className="h-10 flex items-center font-mono text-sm">
                  {batchData.fcBatchName}
                </div>
              </div>
              <div>
                <Label>MFO ID</Label>
                <div className="h-10 flex items-center font-mono text-sm">
                  {batchData.mfoId}
                </div>
              </div>
              <div>
                <Label htmlFor="multipart-tote-id">Multipart Tote ID</Label>
                <Input
                  id="multipart-tote-id"
                  value={multipartToteId}
                  onChange={(e) => setMultipartToteId(e.target.value)}
                  placeholder="e.g. 1304"
                />
              </div>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OP ID</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Current Multipart Tote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchData.products.map((p) => (
                    <TableRow key={p.ordersProductsId}>
                      <TableCell className="font-mono text-xs">
                        {p.ordersProductsId}
                        {p.multipartToteId && (
                          <AlertTriangle
                            className="inline h-3 w-3 text-amber-500 ml-1"
                            aria-label="Already assigned"
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.ordersId}</TableCell>
                      <TableCell className="max-w-xs truncate">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.model ?? '—'}</TableCell>
                      <TableCell className="text-right">{p.quantity}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.multipartToteId ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button onClick={attemptSave} loading={saveMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Save TOTE ({batchData.products.length} product(s))
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite existing Multipart Tote?</AlertDialogTitle>
            <AlertDialogDescription>
              {overwriteCount} product(s) in this batch already have a multipart tote ID assigned.
              Saving will overwrite them with "{multipartToteId.trim()}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveMutation.mutate()}>
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
