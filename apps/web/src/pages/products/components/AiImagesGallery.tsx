/**
 * AiImagesSection — section toolbar, source-filter tags, low-res banner, and
 * the horizontal thumbnail gallery with per-tile action bar. Extracted verbatim
 * from AiGenerationPanel.tsx (no behaviour change): identical markup + handlers,
 * moved behind the controller object. The derived source lists / filtered
 * images are computed here exactly as they were in the component body.
 */

import {
  Sparkles, Scissors, CheckCircle2,
  ChevronDown, FlipHorizontal, ZoomIn, Loader2, Wand2,
  Star as StarFill, Crop as CropIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SectionToolbar } from './SectionToolbar';
import { VISIBLE_SOURCE_TAGS } from './aiGeneration.constants';
import type { AiImagesController } from './useAiImagesSection';

export function AiImagesGallery({ ctrl }: { ctrl: AiImagesController }) {
  const {
    images,
    activeSourceFilter,
    setActiveSourceFilter,
    moreSourcesOpen,
    setMoreSourcesOpen,
    dimensionFilterLifted,
    setEnhanceResultsOpen,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    approvedIds,
    primaryId,
    backId,
    setLightboxImage,
    toggleApprove,
    togglePrimary,
    toggleBack,
    removeBackgroundIds,
    bgRemoveState,
    handleScissorsClick,
    croppedIds,
    cropButtonLoadingId,
    handleCropClick,
    enhanceState,
    setEnhanceTarget,
  } = ctrl;

  // Sources discovered in the live results
  const allSources = Array.from(new Set(images.map((i) => i.source))).sort();
  const visibleSources = allSources.slice(0, VISIBLE_SOURCE_TAGS);
  const overflowSources = allSources.slice(VISIBLE_SOURCE_TAGS);

  const filteredImages = activeSourceFilter
    ? images.filter((img) => img.source === activeSourceFilter)
    : images;

  return (
    <>
      {/* Toolbar */}
      <SectionToolbar
        onEnhance={() => setEnhanceResultsOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        badge={
          approvedIds.size > 0 ? (
            <Badge className="text-[10px] bg-green-600 hover:bg-green-600 ml-1">
              {approvedIds.size} approved
            </Badge>
          ) : undefined
        }
      />

      {/* Source filter tags */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground shrink-0">Source:</span>
        <button
          type="button"
          onClick={() => setActiveSourceFilter(null)}
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
            !activeSourceFilter
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border hover:bg-muted/60',
          )}
        >
          All
        </button>
        {visibleSources.map((src) => (
          <button
            key={src}
            type="button"
            onClick={() => setActiveSourceFilter(activeSourceFilter === src ? null : src)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
              activeSourceFilter === src
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted/60',
            )}
          >
            {src}
          </button>
        ))}
        {overflowSources.length > 0 && (
          <Popover open={moreSourcesOpen} onOpenChange={setMoreSourcesOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-border px-2 py-0.5 text-[10px] hover:bg-muted/60 flex items-center gap-0.5"
              >
                +{overflowSources.length} more
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start">
              {overflowSources.map((src) => (
                <button
                  key={src}
                  type="button"
                  className={cn(
                    'w-full rounded px-2 py-1 text-xs text-left hover:bg-muted',
                    activeSourceFilter === src && 'bg-primary/10 text-primary font-medium',
                  )}
                  onClick={() => {
                    setActiveSourceFilter(activeSourceFilter === src ? null : src);
                    setMoreSourcesOpen(false);
                  }}
                >
                  {src}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {dimensionFilterLifted && (
        <div className="text-[11px] text-amber-700 bg-amber-50/50 border border-amber-200 rounded px-2 py-1">
          No high-resolution images found — showing all matches including thumbnails.
        </div>
      )}

      {/* Horizontal thumbnail strip */}
      <div className="flex gap-2.5 overflow-x-auto pb-2">
        {filteredImages.map((img) => {
          const approved = approvedIds.has(img.id);
          const isPrimary = primaryId === img.id;
          const isBack = backId === img.id;
          return (
            <div key={img.id} className="w-[260px] shrink-0">
              {/* Image — clickable to enlarge */}
              <div
                className={cn(
                  'h-[260px] rounded-t border-2 overflow-hidden transition-colors cursor-zoom-in relative group bg-muted/20',
                  isPrimary ? 'border-yellow-500' : isBack ? 'border-blue-500' : approved ? 'border-green-500' : 'border-border',
                )}
                onClick={() => setLightboxImage(img)}
              >
                <img
                  src={img.thumbnailUrl}
                  alt={img.label}
                  loading="lazy"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    // Fallback chain: thumbnail → upgraded url → original Serper url → hide.
                    // The upgraded `url` may 404 on a CDN edge; `fallbackUrl` is the
                    // original Serper-served URL kept alongside it for exactly this case.
                    const el = e.currentTarget as HTMLImageElement;
                    if (el.src !== img.url) {
                      el.src = img.url;
                    } else if (img.fallbackUrl && el.src !== img.fallbackUrl) {
                      el.src = img.fallbackUrl;
                    } else {
                      el.style.display = 'none';
                    }
                  }}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <ZoomIn className="h-5 w-5 text-white drop-shadow" />
                </div>
                {/* Primary / Back badges */}
                {isPrimary && (
                  <span className="absolute top-1 left-1 rounded bg-yellow-500 px-1 py-0.5 text-[8px] font-bold text-white">
                    Primary
                  </span>
                )}
                {isBack && (
                  <span className="absolute top-1 left-1 rounded bg-blue-500 px-1 py-0.5 text-[8px] font-bold text-white">
                    Back
                  </span>
                )}
                {/* AI enhancement indicator — keeps the original source label
                    visible while signalling that the image has been processed.
                    Native title tooltip (matches the rest of the action bar
                    rather than pulling in Radix Tooltip + Provider). */}
                {img.enhanced && (
                  <span
                    className="absolute top-1 right-1 rounded-full bg-amber-500 p-0.5 shadow-sm"
                    title={
                      img.enhanced.type === 'quality'
                        ? 'AI quality enhanced'
                        : `AI edited: "${img.enhanced.prompt ?? ''}"`
                    }
                  >
                    <Sparkles className="h-3 w-3 text-white" />
                  </span>
                )}
              </div>

              {/* Source label */}
              <div className="text-[9px] text-muted-foreground/60 text-center py-0.5 bg-muted/20 border-x border-border truncate px-1">
                {img.source}
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-px rounded-b border border-t-0 bg-background px-0.5 py-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-9 flex-1 p-0 rounded-sm',
                    approved && 'text-green-600 bg-green-50 hover:bg-green-100',
                  )}
                  title={approved ? 'Approved — click to unapprove' : 'Approve'}
                  onClick={() => toggleApprove(img.id)}
                >
                  <CheckCircle2 className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-9 flex-1 p-0 rounded-sm',
                    isPrimary && 'text-yellow-600 bg-yellow-50 hover:bg-yellow-100',
                  )}
                  title={isPrimary ? 'Primary image (click to unset)' : 'Set as primary image'}
                  onClick={() => togglePrimary(img.id)}
                >
                  <StarFill className={cn('h-5 w-5', isPrimary ? 'fill-yellow-500' : '')} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-9 flex-1 p-0 rounded-sm',
                    isBack && 'text-blue-600 bg-blue-50 hover:bg-blue-100',
                  )}
                  title={isBack ? 'Back image (click to unset)' : 'Set as back image'}
                  onClick={() => toggleBack(img.id)}
                >
                  <FlipHorizontal className={cn('h-5 w-5', isBack ? 'text-blue-600' : 'text-muted-foreground')} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-9 flex-1 p-0 rounded-sm',
                    removeBackgroundIds.has(img.id) && 'text-orange-600 bg-orange-50 hover:bg-orange-100',
                  )}
                  title={
                    removeBackgroundIds.has(img.id)
                      ? 'Background removed — click to revert to original'
                      : 'Remove background'
                  }
                  disabled={bgRemoveState?.imgId === img.id && bgRemoveState.status === 'loading'}
                  onClick={() => handleScissorsClick(img)}
                >
                  {bgRemoveState?.imgId === img.id && bgRemoveState.status === 'loading' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Scissors className={cn('h-5 w-5', removeBackgroundIds.has(img.id) ? 'text-orange-600' : '')} />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-9 flex-1 p-0 rounded-sm',
                    croppedIds.has(img.id) && 'text-cyan-600 bg-cyan-50 hover:bg-cyan-100',
                  )}
                  title={
                    croppedIds.has(img.id)
                      ? 'Cropped — click to re-crop or revert'
                      : 'Crop image (locked 1:1 square)'
                  }
                  disabled={cropButtonLoadingId === img.id}
                  onClick={() => handleCropClick(img)}
                >
                  {cropButtonLoadingId === img.id ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <CropIcon className={cn('h-5 w-5', croppedIds.has(img.id) ? 'text-cyan-600' : '')} />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 flex-1 p-0 rounded-sm text-purple-500 hover:text-purple-700"
                  title="Enhance image (quality upscale or AI edit)"
                  disabled={enhanceState?.imgId === img.id && enhanceState.status === 'loading'}
                  onClick={() => setEnhanceTarget(img)}
                >
                  {enhanceState?.imgId === img.id && enhanceState.status === 'loading' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Wand2 className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
