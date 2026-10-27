/**
 * Per-image enhancement picker. Opens when the user clicks the wand on a tile.
 * Asks whether to upscale (Real-ESRGAN, no prompt) or AI-edit (Nano Banana,
 * needs a prompt) and collects the prompt with optional preset chips.
 */
import { useEffect, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  buildImageEditPrompts,
  type ImageEditPreset,
} from '../utils/imageEditPrompts';

/** Output of the dialog. `quality` upscales without a prompt; `edit` is a
 *  text-guided AI edit. */
export type EnhanceMode =
  | { type: 'quality' }
  | { type: 'edit'; prompt: string };

/**
 * Fallback presets used when the dialog is opened before product context is
 * available — covers the rare case of an enhance click with no productInfo.
 * Kept module-local so the AiImagesSection callsite stays unchanged.
 */
const FALLBACK_EDIT_PROMPTS: ImageEditPreset[] = buildImageEditPrompts({});

export interface EnhanceModeDialogProps {
  open: boolean;
  imageLabel?: string;
  /** Context-aware preset prompts. Falls back to a generic set when omitted. */
  presets?: ImageEditPreset[];
  onOpenChange: (v: boolean) => void;
  onApply: (mode: EnhanceMode) => void;
}

export function EnhanceModeDialog({
  open,
  imageLabel,
  presets,
  onOpenChange,
  onApply,
}: EnhanceModeDialogProps) {
  const effectivePresets = presets && presets.length > 0 ? presets : FALLBACK_EDIT_PROMPTS;
  const [mode, setMode] = useState<'quality' | 'edit'>('quality');
  const [prompt, setPrompt] = useState('');

  // Reset whenever the dialog reopens so a previous prompt doesn't leak across
  // images.
  useEffect(() => {
    if (open) {
      setMode('quality');
      setPrompt('');
    }
  }, [open]);

  const canSubmit = mode === 'quality' || prompt.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Enhance image{imageLabel ? ` — ${imageLabel}` : ''}
          </DialogTitle>
          <DialogDescription>
            Pick a quality upscale or describe an AI edit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('quality')}
            className={cn(
              'rounded-md border p-3 text-left transition-colors',
              mode === 'quality'
                ? 'border-purple-500 bg-purple-50/60 ring-1 ring-purple-500'
                : 'border-border hover:bg-muted/50',
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Wand2 className="h-3.5 w-3.5 text-purple-600" />
              Improve Quality
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Sharpen &amp; upscale 4x. No prompt needed.
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={cn(
              'rounded-md border p-3 text-left transition-colors',
              mode === 'edit'
                ? 'border-purple-500 bg-purple-50/60 ring-1 ring-purple-500'
                : 'border-border hover:bg-muted/50',
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-purple-600" />
              AI Edit
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Describe what to change with AI.
            </div>
          </button>
        </div>

        {mode === 'edit' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {effectivePresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPrompt(p.prompt)}
                  className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] hover:bg-muted/60"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Textarea
              placeholder="e.g. Show only the shirt on a clean white background…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              Tip: pick a preset above to fill the prompt, then tweak as needed.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              const next: EnhanceMode =
                mode === 'quality' ? { type: 'quality' } : { type: 'edit', prompt: prompt.trim() };
              onApply(next);
              onOpenChange(false);
            }}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Enhance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
