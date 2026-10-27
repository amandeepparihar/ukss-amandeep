/**
 * AiImagesSection — background-removal before/after + error, and manual crop +
 * error dialogs. Extracted verbatim from AiGenerationPanel.tsx (no behaviour
 * change).
 */

import { Loader2, ZoomIn } from 'lucide-react';
import Cropper from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ZoomableImage } from './ZoomableImage';
import type { AiImagesController } from './useAiImagesSection';

export function AiImagesCropBgDialogs({ ctrl }: { ctrl: AiImagesController }) {
  const {
    setFullScreenImg,
    bgRemoveState,
    setBgRemoveState,
    afterBgImgLoaded,
    setAfterBgImgLoaded,
    applyBgRemoved,
    cropState,
    setCropState,
    croppedIds,
    revertCrop,
    applyCropFromDialog,
  } = ctrl;

  return (
    <>
      {/* Per-image remove-background: before/after comparison dialog */}
      <Dialog
        open={bgRemoveState !== null && bgRemoveState.status === 'preview'}
        onOpenChange={(o) => { if (!o) setBgRemoveState(null); }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Remove Background — {bgRemoveState?.label}</DialogTitle>
            <DialogDescription>
              Compare the original with the bg-removed version and choose which to keep.
            </DialogDescription>
          </DialogHeader>
          {bgRemoveState?.status === 'preview' && bgRemoveState.bgRemovedUrl && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <ZoomableImage
                  src={bgRemoveState.originalUrl}
                  alt="Before"
                  onClick={() => setFullScreenImg({ url: bgRemoveState.originalUrl, label: 'Before' })}
                />
                <div className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  Before
                </div>
              </div>
              <div className="space-y-1.5">
                <ZoomableImage
                  src={bgRemoveState.bgRemovedUrl}
                  alt="After"
                  enabled={afterBgImgLoaded}
                  onLoad={() => setAfterBgImgLoaded(true)}
                  onError={() => setAfterBgImgLoaded(true)}
                  onClick={() => setFullScreenImg({ url: bgRemoveState.bgRemovedUrl!, label: 'After (Background removed)' })}
                >
                  {!afterBgImgLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted/40 backdrop-blur-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                      <span className="text-[10px] text-muted-foreground">Loading bg-removed image…</span>
                    </div>
                  )}
                </ZoomableImage>
                <div className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  After (Background removed)
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBgRemoveState(null)}
            >
              Keep original
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (bgRemoveState?.bgRemovedUrl) {
                  applyBgRemoved(bgRemoveState.imgId, bgRemoveState.originalUrl, bgRemoveState.bgRemovedUrl);
                }
                setBgRemoveState(null);
              }}
              disabled={!bgRemoveState?.bgRemovedUrl}
            >
              Use bg-removed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-image remove-background: error toast */}
      <Dialog
        open={bgRemoveState?.status === 'error'}
        onOpenChange={(o) => { if (!o) setBgRemoveState(null); }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Background removal failed</DialogTitle>
            <DialogDescription>{bgRemoveState?.errorMsg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBgRemoveState(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-image manual crop: square-locked cropper dialog */}
      <Dialog
        open={cropState !== null && (cropState.status === 'editing' || cropState.status === 'applying')}
        onOpenChange={(o) => { if (!o && cropState?.status !== 'applying') setCropState(null); }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Crop Image — {cropState?.label}</DialogTitle>
            <DialogDescription>
              Drag to reposition, use the slider to zoom. The crop is locked to a
              1:1 square and saved at exactly 1080×1080.
            </DialogDescription>
          </DialogHeader>
          {cropState && (
            <>
              <div className="relative w-full h-[360px] bg-muted rounded overflow-hidden">
                <Cropper
                  image={cropState.sourceUrl}
                  crop={cropState.crop}
                  zoom={cropState.zoom}
                  aspect={1}
                  restrictPosition
                  onCropChange={(crop) => setCropState((s) => (s ? { ...s, crop } : s))}
                  onZoomChange={(zoom) => setCropState((s) => (s ? { ...s, zoom } : s))}
                  onCropComplete={(_area, croppedAreaPixels) =>
                    setCropState((s) => (s ? { ...s, croppedAreaPixels } : s))
                  }
                />
              </div>
              <div className="flex items-center gap-3 px-1 pt-2">
                <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={cropState.zoom}
                  onChange={(e) =>
                    setCropState((s) => (s ? { ...s, zoom: Number(e.target.value) } : s))
                  }
                  className="flex-1 accent-cyan-600"
                  aria-label="Zoom"
                />
              </div>
            </>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {cropState && croppedIds.has(cropState.imgId) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => revertCrop(cropState.imgId)}
                disabled={cropState.status === 'applying'}
              >
                Revert to original
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setCropState(null)}
              disabled={cropState?.status === 'applying'}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={applyCropFromDialog}
              disabled={!cropState?.croppedAreaPixels || cropState?.status === 'applying'}
            >
              {cropState?.status === 'applying' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying…
                </>
              ) : (
                'Apply crop'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-image manual crop: error toast */}
      <Dialog
        open={cropState?.status === 'error'}
        onOpenChange={(o) => { if (!o) setCropState(null); }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Crop failed</DialogTitle>
            <DialogDescription>{cropState?.errorMsg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCropState(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
