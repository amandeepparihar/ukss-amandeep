/**
 * Inter-admin order query component — submit queries to other admins,
 * view query history, and use query templates.
 * Requirements: REQ-08-011, REQ-08-013
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { formatDbDateTime } from '@/lib/date-utils';
import {
  useOrderQueries,
  useQueryTemplates,
  useQueryAdmins,
  useCreateQuery,
} from '../hooks/useOrderQueries';

interface OrderQueriesProps {
  orderId: number;
}

export function OrderQueries({ orderId }: OrderQueriesProps) {
  const { data: queries = [] } = useOrderQueries(orderId);
  const { data: templates = [] } = useQueryTemplates();
  const { data: admins = [] } = useQueryAdmins();
  const createMutation = useCreateQuery(orderId);

  const [queryTo, setQueryTo] = useState('');
  const [queryContent, setQueryContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [isTemplate, setIsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // REQ-08-011: Load template content into textarea from cached data
  const handleTemplateChange = (value: string) => {
    setSelectedTemplate(value);
    if (!value) return;
    const tpl = templates.find((t) => t.name === value);
    if (tpl) setQueryContent(tpl.content);
  };

  // REQ-08-013: Submit query
  const handleSubmit = () => {
    if (!queryContent.trim()) {
      toast.error('Please add your query');
      return;
    }
    if (!queryTo) {
      toast.error('Please select a recipient');
      return;
    }
    if (isTemplate && !templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    createMutation.mutate(
      {
        queryTo: Number(queryTo),
        queryContent,
        isTemplate,
        templateName: isTemplate ? templateName : '',
      },
      {
        onSuccess: (result) => {
          toast.success(result.message || 'Query submitted');
          setQueryContent('');
          setQueryTo('');
          setSelectedTemplate('');
          setIsTemplate(false);
          setTemplateName('');
        },
        onError: (error) => {
          const msg = (error as { response?: { data?: { message?: string } } })
            ?.response?.data?.message || 'Failed to submit query';
          toast.error(msg);
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Order Queries</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Query form */}
        <div className="space-y-3">
          {/* Recipient selection (REQ-08-013) */}
          <div className="space-y-1">
            <Label className="text-sm">Send To</Label>
            <Select value={queryTo} onValueChange={setQueryTo}>
              <SelectTrigger>
                <SelectValue placeholder="Select admin..." />
              </SelectTrigger>
              <SelectContent>
                {admins.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Query template selector (REQ-08-011) */}
          {templates.length > 0 && (
            <div className="space-y-1">
              <Label className="text-sm">Query Template</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Query content textarea */}
          <div className="space-y-1">
            <Label className="text-sm">Query</Label>
            <Textarea
              value={queryContent}
              onChange={(e) => setQueryContent(e.target.value)}
              placeholder="Type your query..."
              rows={3}
            />
          </div>

          {/* Save as template checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="query-template"
              checked={isTemplate}
              onCheckedChange={(c) => setIsTemplate(!!c)}
            />
            <Label htmlFor="query-template" className="text-sm">
              Save as template
            </Label>
          </div>

          {isTemplate && (
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
            />
          )}

          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            size="sm"
            className="w-full"
          >
            {createMutation.isPending ? 'Sending...' : 'Send Query'}
          </Button>
        </div>

        {/* Query history (REQ-08-013) */}
        {queries.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <Label className="text-sm font-medium">Query History</Label>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {queries.map((q) => (
                <div
                  key={q.id}
                  className="rounded border bg-muted/50 p-2 text-sm"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      <strong>{q.from}</strong> → {q.to}
                    </span>
                    <span>{q.dateAdded ? formatDbDateTime(q.dateAdded) : ''}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{q.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
