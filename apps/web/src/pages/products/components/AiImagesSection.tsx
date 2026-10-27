/**
 * AiImagesSection — the wizard's Step 3 (AI image search + selection).
 * Extracted from AiGenerationPanel.tsx (no behaviour change): all state + logic
 * live in useAiImagesSection; the JSX is split across sibling presentational
 * components (config knobs, dialogs, gallery). This file keeps the state-machine
 * early returns and composes those pieces exactly as the original did.
 */

import { Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductInfo, ImagesState } from './aiGeneration.types';
import { useAiImagesSection } from './useAiImagesSection';
import { AiImagesConfigKnobs } from './AiImagesConfigKnobs';
import { AiImagesDialogs } from './AiImagesDialogs';
import { AiImagesGallery } from './AiImagesGallery';

export function AiImagesSection({
  productListsId,
  productInfo,
  onStateChange,
}: {
  productListsId: number | null;
  productInfo: ProductInfo | null | undefined;
  onStateChange?: (state: ImagesState) => void;
}) {
  const ctrl = useAiImagesSection({ productListsId, productInfo, onStateChange });
  const { state, errorMsg, images, runDifyFresh } = ctrl;

  if (state === 'idle') {
    return (
      <p className="text-xs text-muted-foreground py-1">
        Save product details to start AI image search.
      </p>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-2">
        <AiImagesConfigKnobs ctrl={ctrl} />
        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium">Image generation failed</p>
            <p className="text-red-600/80">{errorMsg}</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'searching') {
    return (
      <div className="space-y-3">
        <AiImagesConfigKnobs ctrl={ctrl} />
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border-4 border-purple-100" />
              <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-purple-500 border-t-transparent animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Searching for images...</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                AI is finding product images from the web
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="space-y-2">
        <AiImagesConfigKnobs ctrl={ctrl} />
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-xs font-medium text-amber-800">No images found</p>
              <p className="text-[11px] text-amber-700/80 mt-0.5">
                The AI workflow couldn't find any images for this product. Try adjusting the number of results or retry the search.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs border-amber-300 hover:bg-amber-100"
              onClick={() => runDifyFresh()}
              disabled={!productInfo}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Retry Image Search
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AiImagesConfigKnobs ctrl={ctrl} />
      <AiImagesDialogs ctrl={ctrl} />
      <AiImagesGallery ctrl={ctrl} />
    </div>
  );
}
