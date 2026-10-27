/**
 * Panel refund review section — conditional buttons + comment display.
 * Requirements: REQ-03-015 (refund review actions)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateRefundReview } from '../../hooks/useOrderPanel';

interface PanelRefundReviewProps {
  orderId: number;
  refundReviewStatus: number;
  refundReviewComment: string | null;
}

export function PanelRefundReview({
  orderId,
  refundReviewStatus,
  refundReviewComment,
}: PanelRefundReviewProps) {
  const mutation = useUpdateRefundReview(orderId);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');

  const handleAction = async (status: number, commentText?: string) => {
    try {
      await mutation.mutateAsync({ status, comment: commentText });
      toast.success(
        status === 0 ? 'Removed from refund review'
          : status === 2 ? 'Refund review resolved'
          : 'Added to refund review'
      );
      setShowCommentInput(false);
      setComment('');
    } catch {
      toast.error('Failed to update refund review status');
    }
  };

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Refund Review</div>

        <div className="flex flex-wrap gap-1.5">
          {/* REQ-03-015: "Refund Review" when status == 0 */}
          {refundReviewStatus === 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => setShowCommentInput(true)}
            >
              {mutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Refund Review
            </Button>
          )}

          {/* REQ-03-015: "Remove" and "Resolve" when status == 1 */}
          {refundReviewStatus === 1 && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => handleAction(0)}
              >
                Remove From Review
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => handleAction(2)}
              >
                Resolve
              </Button>
            </>
          )}
        </div>

        {/* Comment input for adding to refund review */}
        {showCommentInput && (
          <div className="space-y-2">
            <Textarea
              placeholder="Enter refund review comment..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="text-sm"
              rows={3}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => handleAction(1, comment)}
              >
                Submit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowCommentInput(false); setComment(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* REQ-03-015: Display comment when in review */}
        {refundReviewStatus === 1 && refundReviewComment && (
          <div className="text-sm mt-2">
            <span className="font-medium">Refund Review Comment:</span>
            <p className="mt-1 break-all whitespace-pre-wrap text-muted-foreground">
              {refundReviewComment}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
