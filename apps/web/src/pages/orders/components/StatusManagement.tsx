/**
 * Status management form — status dropdown, comments, template selector,
 * notification checkboxes, and submit button.
 * Requirements: REQ-07-001, REQ-07-002, REQ-07-021, REQ-07-022, REQ-07-023
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useStatusUpdate, useStatusTemplates, useReplyTemplates } from '../hooks/useOrderStatus';
import { useOrderStatuses } from '../hooks/useOrders';

interface StatusManagementProps {
  orderId: number;
  currentStatus: number;
  currentStatusName: string;
  isMultisite: boolean;
}

export function StatusManagement({
  orderId,
  currentStatus,
  currentStatusName,
  isMultisite,
}: StatusManagementProps) {
  const { data: statuses } = useOrderStatuses();
  const { data: templates } = useStatusTemplates();
  const { data: replyTemplates } = useReplyTemplates();
  const statusMutation = useStatusUpdate(orderId);

  const [selectedStatus, setSelectedStatus] = useState(String(currentStatus));
  const [comments, setComments] = useState('');
  const [notify, setNotify] = useState(!isMultisite);
  const [notifyComments, setNotifyComments] = useState(true);
  const [privateComment, setPrivateComment] = useState(false);
  const [useOriginalEmail, setUseOriginalEmail] = useState(false);
  const [sendMessageAutomatically, setSendMessageAutomatically] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedReplyTemplate, setSelectedReplyTemplate] = useState('');

  // Sync when order changes
  useEffect(() => {
    setSelectedStatus(String(currentStatus));
    setComments('');
    setNotify(!isMultisite);
    setNotifyComments(true);
    setPrivateComment(false);
    setUseOriginalEmail(false);
    setSendMessageAutomatically(false);
    setSelectedTemplate('');
    setSelectedReplyTemplate('');
  }, [orderId, currentStatus, isMultisite]);

  // REQ-07-022: Status-specific checkbox behavior (ported from show_suppliers_dd)
  useEffect(() => {
    const statusNum = parseInt(selectedStatus, 10);
    if (isMultisite) return; // Multisite: notify always off

    // Pre-order/retro/awaiting statuses: uncheck notify
    if (statusNum === 23 || statusNum === 12 || statusNum === 128) {
      setNotify(false);
    } else {
      setNotify(true);
    }

  }, [selectedStatus, isMultisite]);

  // REQ-07-023: Load template content into comments (shared handler for both dropdowns)
  const handleAnyTemplateChange = (
    templateId: string,
    source: 'outgoing' | 'reply'
  ) => {
    setSelectedTemplate(source === 'outgoing' ? templateId : '');
    setSelectedReplyTemplate(source === 'reply' ? templateId : '');
    if (!templateId) return;

    const pool = source === 'outgoing' ? templates : replyTemplates;
    const template = pool?.find((t) => String(t.id) === templateId);
    if (template) {
      setComments(template.content);
    }
  };

  const handleSubmit = () => {
    const statusNum = parseInt(selectedStatus, 10);

    statusMutation.mutate(
      {
        status: statusNum,
        previousOrderStatus: currentStatus,
        comments,
        notify: privateComment ? false : notify, // Private overrides notify
        notifyComments,
        privateComment,
        useOriginalEmail,
        sendMessageAutomatically,
        pageForLog: 'EditOrderPage',
      },
      {
        onSuccess: (result) => {
          if (result.status === 'success') {
            toast.success(result.message);
            setComments('');
            setSelectedTemplate('');
            setSelectedReplyTemplate('');
            // Warn about marketplace errors if any
            if (result.data?.marketplaceErrors?.length) {
              for (const err of result.data.marketplaceErrors) {
                toast.warning(err);
              }
            }
          } else {
            toast.error(result.message);
          }
        },
        onError: (error) => {
          const msg = (error as { response?: { data?: { message?: string } } })
            ?.response?.data?.message || 'Status update failed';
          toast.error(msg);
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Update Status — {currentStatusName} [{currentStatus}]
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status dropdown (REQ-07-021) */}
        {/* Render only after statuses are loaded so Radix Select can match the
            controlled value against an existing SelectItem on first paint.
            Without this guard, the trigger shows the placeholder because there
            are no children to derive a display label from when value is set. */}
        <div className="space-y-2">
          <Label>Status</Label>
          {statuses ? (
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} [{s.id}]
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            // Must stay wrapped in <Select>: a bare <SelectTrigger> throws
            // "SelectTrigger must be used within Select" and (no error boundary)
            // blanks the whole edit page. This branch renders on cold load /
            // refresh, before useOrderStatuses() resolves; on SPA nav the query
            // is already warm from the listing so the truthy branch wins.
            <Select disabled>
              <SelectTrigger>
                <SelectValue placeholder="Loading statuses..." />
              </SelectTrigger>
            </Select>
          )}
        </div>

        {/* Template selector (REQ-07-023) — outgoing templates */}
        {templates && templates.length > 0 && (
          <div className="space-y-2">
            <Label>Select Template</Label>
            <Select value={selectedTemplate} onValueChange={(v) => handleAnyTemplateChange(v, 'outgoing')}>
              <SelectTrigger>
                <SelectValue placeholder="Select template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.title || `Template #${t.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Reply template selector (REQ-07-023) — reply templates */}
        {replyTemplates && replyTemplates.length > 0 && (
          <div className="space-y-2">
            <Label>Select Reply Template</Label>
            <Select value={selectedReplyTemplate} onValueChange={(v) => handleAnyTemplateChange(v, 'reply')}>
              <SelectTrigger>
                <SelectValue placeholder="Select reply template..." />
              </SelectTrigger>
              <SelectContent>
                {replyTemplates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.title || `Template #${t.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Comments textarea */}
        <div className="space-y-2">
          <Label>Comments</Label>
          <Textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add status comments..."
            rows={3}
          />
        </div>

        {/* Checkboxes (REQ-07-002) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="status-notify"
              checked={notify}
              onCheckedChange={(c) => setNotify(!!c)}
              disabled={isMultisite}
            />
            <Label htmlFor="status-notify" className="text-sm">
              Notify Customer
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="status-notify-comments"
              checked={notifyComments}
              onCheckedChange={(c) => setNotifyComments(!!c)}
              disabled={!notify}
            />
            <Label htmlFor="status-notify-comments" className="text-sm">
              Include Comments
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="status-private"
              checked={privateComment}
              onCheckedChange={(c) => setPrivateComment(!!c)}
            />
            <Label htmlFor="status-private" className="text-sm">
              Private Comment
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="status-original-email"
              checked={useOriginalEmail}
              onCheckedChange={(c) => setUseOriginalEmail(!!c)}
            />
            <Label htmlFor="status-original-email" className="text-sm">
              Use Original Email
            </Label>
          </div>

          {/* Send message automatically — always visible, matching zenc behavior */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="status-auto-send"
              checked={sendMessageAutomatically}
              onCheckedChange={(c) => setSendMessageAutomatically(!!c)}
            />
            <Label htmlFor="status-auto-send" className="text-sm">
              Send Automatically (Cron)
            </Label>
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={statusMutation.isPending}
          className="w-full"
        >
          {statusMutation.isPending ? 'Updating...' : 'Update Status'}
        </Button>
      </CardContent>
    </Card>
  );
}
