/**
 * AiImagesSection — lightbox, bulk-enhance, per-image mode picker, enhance
 * before/after + error, and the full-screen viewer dialogs. Extracted verbatim
 * from AiGenerationPanel.tsx (no behaviour change).
 */

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { buildImageEditPrompts } from '../utils/imageEditPrompts';
import { ZoomableImage } from './ZoomableImage';
import { EnhanceDialog } from './EnhanceDialog';
import { EnhanceModeDialog } from './EnhanceModeDialog';
import type { AiImagesController } from './useAiImagesSection';

export function AiImagesEnhanceDialogs({ ctrl }: { ctrl: AiImagesController }) {
  const {
    lightboxImage,
    setLightboxImage,
    fullScreenImg,
    setFullScreenImg,
    enhanceResultsOpen,
    setEnhanceResultsOpen,
    runDifyFresh,
    enhanceTarget,
    setEnhanceTarget,
    productInfo,
    runEnhance,
    enhanceState,
    setEnhanceState,
    afterImgLoaded,
    setAfterImgLoaded,
    applyEnhanced,
  } = ctrl;

  return (
    <>
      {/* Lightbox — hover-zoom (cursor-tracked, 2.2x) + click for full-size.
          Re-uses the same ZoomableImage as the before/after compare dialogs so
          the gallery and the comparison get identical inspection behaviour. */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent className="sm:max-w-[480px] p-2">
          {lightboxImage && (
            <>
              <ZoomableImage
                src={lightboxImage.url}
                alt={lightboxImage.label}
                fallbackSrc={lightboxImage.fallbackUrl}
                onClick={() => setFullScreenImg({ url: lightboxImage.url, label: lightboxImage.label })}
              />
              <div className="text-center text-xs text-muted-foreground">
                {lightboxImage.label} · {lightboxImage.source}
                <span className="ml-1 opacity-70">· click to open full size</span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk enhance dialog (refines the search query, runs a fresh workflow) */}
      <EnhanceDialog
        open={enhanceResultsOpen}
        onOpenChange={setEnhanceResultsOpen}
        title="Enhance Image Results"
        description="Provide instructions to refine the overall image search results."
        placeholder="e.g. Show only official product shots on white background, no lifestyle images…"
        onApply={(prompt) => runDifyFresh(prompt)}
      />

      {/* Per-image mode picker — Improve Quality vs AI Edit (with prompt).
          Presets are computed from productInfo so a "ghost mannequin" pick on
          a football shirt asks the LLM to keep the shirt only, while the same
          pick on shorts keeps the shorts only. */}
      <EnhanceModeDialog
        open={enhanceTarget !== null}
        imageLabel={enhanceTarget?.label}
        presets={buildImageEditPrompts({
          productTypeName: productInfo?.productTypeName,
          productName: productInfo?.productName,
          teamName: productInfo?.teamName,
          season: productInfo?.season,
        })}
        onOpenChange={(o) => { if (!o) setEnhanceTarget(null); }}
        onApply={(mode) => {
          const target = enhanceTarget;
          if (!target) return;
          setEnhanceTarget(null);
          void runEnhance(target, mode);
        }}
      />

      {/* Per-image enhance: before/after comparison dialog (Replicate). */}
      <Dialog
        open={enhanceState !== null && enhanceState.status === 'preview'}
        onOpenChange={(o) => { if (!o) setEnhanceState(null); }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {enhanceState?.mode.type === 'edit'
                ? `AI edit — "${enhanceState.mode.prompt.length > 40
                    ? `${enhanceState.mode.prompt.slice(0, 40)}…`
                    : enhanceState.mode.prompt}"`
                : `Quality enhancement — ${enhanceState?.label ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              Compare the original with the AI result and choose which to keep.
            </DialogDescription>
          </DialogHeader>
          {enhanceState?.status === 'preview' && enhanceState.enhancedUrl && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <ZoomableImage
                    src={enhanceState.originalUrl}
                    alt="Before"
                    onClick={() => setFullScreenImg({ url: enhanceState.originalUrl, label: 'Before' })}
                  />
                  <div className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                    Before
                  </div>
                </div>
                <div className="space-y-1.5">
                  <ZoomableImage
                    src={enhanceState.enhancedUrl}
                    alt="After"
                    enabled={afterImgLoaded}
                    onLoad={() => setAfterImgLoaded(true)}
                    onError={() => setAfterImgLoaded(true)}
                    onClick={() => setFullScreenImg({
                      url: enhanceState.enhancedUrl!,
                      label: enhanceState.mode.type === 'edit' ? 'After (Edited)' : 'After (Enhanced)',
                    })}
                  >
                    {!afterImgLoaded && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted/40 backdrop-blur-sm">
                        <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                        <span className="text-[10px] text-muted-foreground">
                          {enhanceState.mode.type === 'edit' ? 'Loading edited image…' : 'Loading enhanced image…'}
                        </span>
                      </div>
                    )}
                  </ZoomableImage>
                  <div className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                    {enhanceState.mode.type === 'edit' ? 'After (Edited)' : 'After (Enhanced 4x)'}
                  </div>
                </div>
              </div>
            </>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEnhanceState(null)}
            >
              Keep original
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (enhanceState?.enhancedUrl) {
                  applyEnhanced(enhanceState.imgId, enhanceState.enhancedUrl, enhanceState.mode);
                }
                setEnhanceState(null);
              }}
              disabled={!enhanceState?.enhancedUrl}
            >
              {enhanceState?.mode.type === 'edit' ? 'Use edited' : 'Use enhanced'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-screen viewer for before/after images — opened by clicking
          a ZoomableImage tile in the comparison dialog. */}
      <Dialog
        open={!!fullScreenImg}
        onOpenChange={(o) => { if (!o) setFullScreenImg(null); }}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw] p-2 max-h-[90vh]">
          {fullScreenImg && (
            <>
              <img
                src={fullScreenImg.url}
                alt={fullScreenImg.label}
                className="max-h-[80vh] w-full rounded object-contain bg-muted/20"
                onError={(e) => {
                  // Mirror the ZoomableImage fallback chain — full-screen view
                  // is opened from the gallery lightbox where the image carries
                  // both the upgraded URL and the original Serper fallback.
                  const el = e.currentTarget as HTMLImageElement;
                  const fb = lightboxImage?.fallbackUrl;
                  if (fb && el.src !== fb && el.dataset.didFallback !== '1') {
                    el.dataset.didFallback = '1';
                    el.src = fb;
                  }
                }}
              />
              <div className="text-center text-xs text-muted-foreground">
                {fullScreenImg.label}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Per-image enhance: error toast (shown when the call fails) */}
      <Dialog
        open={enhanceState?.status === 'error'}
        onOpenChange={(o) => { if (!o) setEnhanceState(null); }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Enhance failed</DialogTitle>
            <DialogDescription>{enhanceState?.errorMsg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEnhanceState(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
