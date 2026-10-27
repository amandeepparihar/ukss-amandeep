/**
 * AiDescriptionSection — "Generated Description" panel (presentational).
 * Extracted verbatim from AiGenerationPanel.tsx (no behaviour change): same
 * markup, same handlers, just moved behind props so the section file stays small.
 */

import type { RefObject } from 'react';
import { CheckCircle2, Search, Eye, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { descriptionPlainToHtml } from '@admin/shared';
import type { AiState } from './aiGeneration.types';

export function DescriptionEditorPanel({
  state,
  descriptionAccepted,
  setDescriptionAccepted,
  descPreview,
  setDescPreview,
  descriptionText,
  setDescriptionText,
  descTextareaRef,
}: {
  state: AiState;
  descriptionAccepted: boolean;
  setDescriptionAccepted: (updater: (v: boolean) => boolean) => void;
  descPreview: boolean;
  setDescPreview: (updater: (v: boolean) => boolean) => void;
  descriptionText: string;
  setDescriptionText: (value: string) => void;
  descTextareaRef: RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div className={cn(
      'rounded-md border p-3 space-y-2 transition-colors',
      descriptionAccepted ? 'border-blue-200 bg-blue-50/30' : 'border-border bg-muted/20',
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Generated Description
        </p>
        {state !== 'searching' && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => setDescPreview((v) => !v)}
              title={descPreview ? 'Switch to plain-text editing' : 'Preview formatted description'}
            >
              {descPreview ? (
                <><Pencil className="mr-1 h-3 w-3" />Edit</>
              ) : (
                <><Eye className="mr-1 h-3 w-3" />Preview</>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={descriptionAccepted ? 'default' : 'outline'}
              className={cn(
                'h-6 px-2 text-[10px]',
                descriptionAccepted && 'bg-blue-600 hover:bg-blue-700 border-blue-600',
              )}
              onClick={() => setDescriptionAccepted((v) => !v)}
            >
              {descriptionAccepted && <CheckCircle2 className="mr-1 h-3 w-3" />}
              {descriptionAccepted ? 'Accepted' : 'Accept'}
            </Button>
          </div>
        )}
      </div>
      {state === 'searching' ? (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5 animate-pulse text-purple-500" />
            Generating description…
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : descPreview ? (
        descriptionText.trim() ? (
          <div
            className={cn(
              'min-h-[8rem] text-xs leading-relaxed',
              '[&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mt-0 [&_h1]:mb-1',
              '[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1',
              '[&_p]:my-1.5 [&_strong]:font-semibold',
              '[&_ul]:my-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_li]:my-0.5',
            )}
            dangerouslySetInnerHTML={{ __html: descriptionPlainToHtml(descriptionText) }}
          />
        ) : (
          <p className="min-h-[8rem] text-xs text-muted-foreground italic">No description yet.</p>
        )
      ) : (
        <Textarea
          ref={descTextareaRef}
          value={descriptionText}
          onChange={(e) => setDescriptionText(e.target.value)}
          rows={1}
          className="resize-none overflow-hidden min-h-[8rem] text-xs leading-relaxed border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      )}
    </div>
  );
}
