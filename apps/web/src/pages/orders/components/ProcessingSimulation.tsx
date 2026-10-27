/**
 * SPEC-13: Processing Simulation component.
 * Requirements: REQ-13-001/002 (simulation display),
 *   REQ-13-003 (disagree), REQ-13-004 (execute)
 *
 * Renders on the order edit page when the order status is eligible for processing.
 * Shows simulation results with per-product stock analysis and action buttons.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Play, ThumbsDown, ThumbsUp, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  useSimulation,
  useDisagree,
  useExecuteProcessing,
} from '../hooks/useOrderProcessing';
import type { SimulationResult } from '../hooks/useOrderProcessing';

interface ProcessingSimulationProps {
  orderId: number;
}

export function ProcessingSimulation({ orderId }: ProcessingSimulationProps) {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [showDisagreeDialog, setShowDisagreeDialog] = useState(false);
  const [disagreeComment, setDisagreeComment] = useState('');

  const simulation = useSimulation(orderId);
  const disagree = useDisagree(orderId);
  const execute = useExecuteProcessing(orderId);

  const handleRunSimulation = async () => {
    try {
      const data = await simulation.mutateAsync();
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run simulation';
      toast.error(message);
    }
  };

  const handleExecute = async () => {
    try {
      await execute.mutateAsync();
      toast.success('Order processed successfully');
      setResult(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      toast.error(message);
    }
  };

  const handleDisagree = async () => {
    if (!disagreeComment.trim()) {
      toast.error('Please provide a reason for disagreeing');
      return;
    }

    try {
      await disagree.mutateAsync(disagreeComment);
      toast.success('Disagreement recorded');
      setShowDisagreeDialog(false);
      setDisagreeComment('');
      setResult(null);
    } catch {
      toast.error('Failed to record disagreement');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Order Processing</CardTitle>
          <Button
            onClick={handleRunSimulation}
            disabled={simulation.isPending}
            size="sm"
          >
            {simulation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run Simulation
          </Button>
        </div>
      </CardHeader>

      {result && (
        <CardContent className="space-y-4">
          {/* Eligibility status */}
          {!result.eligible ? (
            <div className="flex items-center gap-2 rounded-md bg-yellow-50 p-3 text-yellow-800">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Not eligible: {result.reason}</span>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline">
                  {result.stockAvailableCount}/{result.totalProducts} in stock
                </Badge>
                <Badge
                  variant={result.proposedStatusName === 'Being Picked' ? 'default' : 'secondary'}
                >
                  Proposed: {result.proposedStatusName} ({result.proposedStatus})
                </Badge>
                {result.hasPrintingProducts && (
                  <Badge variant="secondary">Has printing</Badge>
                )}
                {result.hasRetroProducts && (
                  <Badge variant="secondary">Has retro products</Badge>
                )}
              </div>

              {/* Product results table */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-center">SMS Stock</TableHead>
                      <TableHead>Box</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.products.map((product) => (
                      <TableRow key={product.ordersProductsId}>
                        <TableCell className="max-w-[200px] truncate text-sm">
                          {product.productName}
                        </TableCell>
                        <TableCell className="text-sm">{product.productsModel}</TableCell>
                        <TableCell className="text-sm">{product.size}</TableCell>
                        <TableCell className="text-center text-sm">{product.quantity}</TableCell>
                        <TableCell className="text-center text-sm">{product.smsStock}</TableCell>
                        <TableCell className="text-sm font-mono">
                          {product.boxNumber || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {product.productType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {product.isOutOfStock ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Warnings */}
              {result.products.some((p) => p.warnings.length > 0) && (
                <div className="space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-medium">Warnings:</p>
                  <ul className="list-inside list-disc">
                    {result.products.flatMap((p) =>
                      p.warnings.map((w, i) => (
                        <li key={`${p.ordersProductsId}-${i}`}>
                          {p.productsModel}: {w}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={handleExecute}
                  disabled={execute.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {execute.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ThumbsUp className="mr-2 h-4 w-4" />
                  )}
                  Agree & Process
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowDisagreeDialog(true)}
                  disabled={disagree.isPending}
                >
                  <ThumbsDown className="mr-2 h-4 w-4" />
                  Disagree
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}

      {/* Disagree dialog */}
      <Dialog open={showDisagreeDialog} onOpenChange={setShowDisagreeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Disagreement</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Why do you disagree with the simulation results?"
            value={disagreeComment}
            onChange={(e) => setDisagreeComment(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisagreeDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisagree}
              disabled={disagree.isPending || !disagreeComment.trim()}
            >
              {disagree.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
