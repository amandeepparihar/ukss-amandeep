/**
 * #1061 P2: "Process Order Queue" action.
 *
 * Triggers the server-side batch engine (POST /orders/process-queue), which
 * selects the eligible queue, assigns an archive number, applies the 15-minute
 * rule and processes orders (pre-orders first). Because this mutates many orders
 * at once, it is gated behind a confirmation dialog.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useProcessQueue } from '../hooks/useOrderProcessing';

export function ProcessQueueButton() {
  const [open, setOpen] = useState(false);
  const processQueue = useProcessQueue();

  const handleConfirm = () => {
    processQueue.mutate(undefined, {
      onSuccess: (result) => {
        setOpen(false);
        toast.success(
          `Queue processed (archive #${result.archiveNumber})`,
          {
            description:
              `${result.processed} processed, ${result.failed} failed` +
              (result.flaggedForManual.length
                ? `, ${result.flaggedForManual.length} held for manual (15-min rule)`
                : ''),
          }
        );
      },
      onError: (err) => {
        toast.error('Queue processing failed', { description: err.message });
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={processQueue.isPending}>
          {processQueue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Process Order Queue
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Process the order queue?</AlertDialogTitle>
          <AlertDialogDescription>
            This selects every eligible queued order, assigns a new archive number
            and processes them (pre-orders first). Orders from the same customer
            placed within 15 minutes are held for manual review. This changes order
            statuses and cannot be undone in bulk.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={processQueue.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={processQueue.isPending}
          >
            {processQueue.isPending ? 'Processing…' : 'Process queue'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
