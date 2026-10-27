/**
 * AiImagesSection — per-image editing slices: Replicate enhance, remove.bg
 * background removal, and manual 1:1 crop. Extracted verbatim from
 * AiGenerationPanel.tsx (no behaviour change). Consumed by useAiImagesSection;
 * receives the gallery `setImages` + the selection's bg-removal id set so the
 * click-time flows mutate the same state they did before the split.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';
import { type Area } from 'react-easy-crop';
import { api, getApiError } from '@/lib/api';
import { type ExtractedImage } from '../utils/difyParse';
import { type EnhanceMode } from './EnhanceModeDialog';

export function useAiImageEditing({
  setImages,
  removeBackgroundIds,
  setRemoveBackgroundIds,
}: {
  setImages: Dispatch<SetStateAction<ExtractedImage[]>>;
  removeBackgroundIds: Set<number>;
  setRemoveBackgroundIds: Dispatch<SetStateAction<Set<number>>>;
}) {
  const [enhanceResultsOpen, setEnhanceResultsOpen] = useState(false);
  // The image whose wand button was clicked; opens the mode picker dialog so
  // the user can pick "Improve Quality" vs "AI Edit" before we hit the API.
  const [enhanceTarget, setEnhanceTarget] = useState<ExtractedImage | null>(null);
  // Per-image Replicate enhance state. While loading, we show a spinner on the
  // tile's Wand2 button; on success, a before/after dialog lets the user pick
  // which version to keep. Selection is final (no undo per UX decision).
  const [enhanceState, setEnhanceState] = useState<{
    imgId: number;
    label: string;
    originalUrl: string;
    mode: EnhanceMode;
    status: 'loading' | 'preview' | 'error';
    enhancedUrl?: string;
    errorMsg?: string;
  } | null>(null);
  // Cache successful enhance results keyed by `${url}::${type}::${prompt}` so
  // a quality-enhanced result and an edit result for the same source URL
  // don't collide. Cache is cleared implicitly when the gallery is rebuilt.
  const [enhanceCache, setEnhanceCache] = useState<Record<string, string>>({});
  // Tracks whether the after-image has finished rendering in the dialog so we
  // can hide the loading overlay. Replicate URLs are CDN-served and the first
  // browser fetch can take several seconds.
  const [afterImgLoaded, setAfterImgLoaded] = useState(false);

  // Per-image remove-background state. Mirrors the enhance flow above:
  // click Scissors → API call → before/after dialog → user picks. The
  // Scissors stays orange after accept to indicate the image is bg-removed,
  // and a second click reverts (using the originalUrlBeforeBg map below).
  const [bgRemoveState, setBgRemoveState] = useState<{
    imgId: number;
    label: string;
    originalUrl: string;
    status: 'loading' | 'preview' | 'error';
    bgRemovedUrl?: string;
    errorMsg?: string;
  } | null>(null);
  const [bgRemovalCache, setBgRemovalCache] = useState<Record<string, string>>({});
  const [afterBgImgLoaded, setAfterBgImgLoaded] = useState(false);
  // Original URL captured when bg removal is accepted, keyed by image id —
  // used to revert when the user clicks Scissors again on a bg-removed tile.
  const [originalUrlBeforeBg, setOriginalUrlBeforeBg] = useState<Record<number, string>>({});

  // Per-image manual crop. Mirrors the bg-removal flow: click Crop → dialog
  // with a square-locked cropper → Apply → backend returns a 1080x1080 data
  // URI. The tile turns cyan while cropped and the dialog offers "Revert".
  const [croppedIds, setCroppedIds] = useState<Set<number>>(new Set());
  const [cropState, setCropState] = useState<{
    imgId: number;
    label: string;
    sourceUrl: string; // what the cropper displays AND what we crop from
    status: 'editing' | 'applying' | 'error';
    crop: { x: number; y: number };
    zoom: number;
    croppedAreaPixels: Area | null;
    errorMsg?: string;
  } | null>(null);
  // Pre-crop source URL captured on the FIRST crop, keyed by image id. Used to
  // (a) revert to the original, (b) re-crop from the original (not the already-
  // cropped derivative), and (c) tell the backend which original to persist.
  const [originalUrlBeforeCrop, setOriginalUrlBeforeCrop] = useState<Record<number, string>>({});
  // Button spinner while we resolve a saved-product tile's persisted original
  // (GET /crop-source) before opening the dialog.
  const [cropButtonLoadingId, setCropButtonLoadingId] = useState<number | null>(null);

  // Per-image remove.bg flow: click Scissors → backend call → before/after
  // dialog. Caches successful results per source URL so closing/reopening the
  // dialog does not re-spend remove.bg credits. Mirrors runEnhance above.
  const runRemoveBackground = async (img: ExtractedImage) => {
    setAfterBgImgLoaded(false);
    const cached = bgRemovalCache[img.url];
    if (cached) {
      setBgRemoveState({
        imgId: img.id,
        label: img.label,
        originalUrl: img.url,
        status: 'preview',
        bgRemovedUrl: cached,
      });
      return;
    }
    setBgRemoveState({ imgId: img.id, label: img.label, originalUrl: img.url, status: 'loading' });
    try {
      const res = await api.post<{ data: { bgRemovedUrl: string; elapsedMs: number } }>(
        '/products/remove-background',
        { imageUrl: img.url },
      );
      const bgRemovedUrl = res.data.data.bgRemovedUrl;
      setBgRemovalCache((prev) => ({ ...prev, [img.url]: bgRemovedUrl }));
      setBgRemoveState((s) =>
        s && s.imgId === img.id ? { ...s, status: 'preview', bgRemovedUrl } : s,
      );
    } catch (err) {
      setBgRemoveState((s) =>
        s && s.imgId === img.id ? { ...s, status: 'error', errorMsg: getApiError(err).message } : s,
      );
    }
  };

  // User picked the bg-removed version from the comparison dialog.
  // Mutate the gallery entry: replace url with the data URI, mark the image
  // as bg-removed (orange Scissors + included in saveDetails payload), and
  // remember the original URL so the user can revert by clicking again.
  const applyBgRemoved = (imgId: number, originalUrl: string, bgRemovedUrl: string) => {
    setOriginalUrlBeforeBg((prev) => ({ ...prev, [imgId]: originalUrl }));
    setImages((prev) =>
      prev.map((img) =>
        img.id === imgId
          ? { ...img, url: bgRemovedUrl, thumbnailUrl: bgRemovedUrl }
          : img,
      ),
    );
    setRemoveBackgroundIds((prev) => new Set(prev).add(imgId));
  };

  const revertBgRemoval = (imgId: number) => {
    const originalUrl = originalUrlBeforeBg[imgId];
    if (originalUrl) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === imgId ? { ...img, url: originalUrl, thumbnailUrl: originalUrl } : img,
        ),
      );
    }
    setRemoveBackgroundIds((prev) => {
      const next = new Set(prev);
      next.delete(imgId);
      return next;
    });
    setOriginalUrlBeforeBg((prev) => {
      const next = { ...prev };
      delete next[imgId];
      return next;
    });
  };

  // Scissors button click handler. If the image is already bg-removed, revert
  // to the original URL; otherwise run the bg-removal flow. Image-content
  // changes (url replacements) are intentionally not pushed to undo/redo
  // history — same policy as the per-image enhance flow.
  const handleScissorsClick = (img: ExtractedImage) => {
    if (removeBackgroundIds.has(img.id)) {
      revertBgRemoval(img.id);
    } else {
      runRemoveBackground(img);
    }
  };

  // ── Manual crop flow ──────────────────────────────────────────────────────
  // A tile URL that lives under our own /images/ path (saved product image or a
  // prior upload) MIGHT have a persisted un-cropped original on disk. External
  // gallery / Dify / data-URI sources never do, so we skip the crop-source
  // round-trip for those.
  const looksLikeSavedImage = (url: string): boolean => {
    if (url.startsWith('data:')) return false;
    try {
      return new URL(url).pathname.includes('/images/');
    } catch {
      return false;
    }
  };

  // Open the crop dialog. Source precedence:
  //   1. in-session pre-crop original (re-crop keeps cropping the original)
  //   2. persisted original for a saved-product tile (GET /crop-source)
  //   3. the tile URL itself
  const handleCropClick = async (img: ExtractedImage) => {
    let sourceUrl = originalUrlBeforeCrop[img.id];
    if (!sourceUrl) {
      if (looksLikeSavedImage(img.url)) {
        setCropButtonLoadingId(img.id);
        try {
          const res = await api.get<{ data: { sourceUrl: string | null } }>(
            '/products/crop-source',
            { params: { imageUrl: img.url } },
          );
          sourceUrl = res.data.data.sourceUrl ?? img.url;
        } catch {
          sourceUrl = img.url; // fall back to the derivative — still croppable
        } finally {
          setCropButtonLoadingId(null);
        }
      } else {
        sourceUrl = img.url;
      }
    }
    setCropState({
      imgId: img.id,
      label: img.label,
      sourceUrl,
      status: 'editing',
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedAreaPixels: null,
    });
  };

  // User accepted the crop: swap the tile URL to the returned data URI, record
  // the pre-crop original (once), and mark the tile as cropped.
  const applyCrop = (imgId: number, originalSource: string, croppedUrl: string) => {
    setOriginalUrlBeforeCrop((prev) => (imgId in prev ? prev : { ...prev, [imgId]: originalSource }));
    setImages((prev) =>
      prev.map((img) =>
        img.id === imgId ? { ...img, url: croppedUrl, thumbnailUrl: croppedUrl } : img,
      ),
    );
    setCroppedIds((prev) => new Set(prev).add(imgId));
  };

  const revertCrop = (imgId: number) => {
    const originalUrl = originalUrlBeforeCrop[imgId];
    if (originalUrl) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === imgId ? { ...img, url: originalUrl, thumbnailUrl: originalUrl } : img,
        ),
      );
    }
    setCroppedIds((prev) => {
      const next = new Set(prev);
      next.delete(imgId);
      return next;
    });
    setOriginalUrlBeforeCrop((prev) => {
      const next = { ...prev };
      delete next[imgId];
      return next;
    });
    setCropState(null);
  };

  // POST the crop rectangle (natural pixels of sourceUrl) to the backend, which
  // does the pixel work and returns a 1080x1080 data URI.
  const applyCropFromDialog = async () => {
    if (!cropState || !cropState.croppedAreaPixels) return;
    const { x, y, width, height } = cropState.croppedAreaPixels;
    // aspect=1 gives a square, but round + equalise so the backend's
    // width === height refine never trips on a sub-pixel mismatch.
    const side = Math.max(1, Math.round(Math.min(width, height)));
    setCropState((s) => (s ? { ...s, status: 'applying' } : s));
    try {
      const res = await api.post<{ data: { croppedUrl: string } }>('/products/crop-image', {
        imageUrl: cropState.sourceUrl,
        crop: { left: Math.max(0, Math.round(x)), top: Math.max(0, Math.round(y)), width: side, height: side },
      });
      applyCrop(cropState.imgId, cropState.sourceUrl, res.data.data.croppedUrl);
      setCropState(null);
    } catch (err) {
      setCropState((s) => (s ? { ...s, status: 'error', errorMsg: getApiError(err).message } : s));
    }
  };

  // Per-image Replicate enhance: call backend, then open the before/after picker.
  // Reuses a cached result keyed by (url, type, prompt) so re-running the same
  // mode+prompt for the same image does NOT re-spend Replicate credits, while
  // a quality result and an edit result for the same source can both coexist.
  const runEnhance = async (img: ExtractedImage, mode: EnhanceMode) => {
    setAfterImgLoaded(false);
    const cacheKey = `${img.url}::${mode.type}::${mode.type === 'edit' ? mode.prompt : ''}`;
    const cached = enhanceCache[cacheKey];
    if (cached) {
      setEnhanceState({
        imgId: img.id,
        label: img.label,
        originalUrl: img.url,
        mode,
        status: 'preview',
        enhancedUrl: cached,
      });
      return;
    }
    setEnhanceState({
      imgId: img.id,
      label: img.label,
      originalUrl: img.url,
      mode,
      status: 'loading',
    });
    try {
      const body: Record<string, unknown> =
        mode.type === 'edit'
          ? { type: 'edit', imageUrl: img.url, prompt: mode.prompt }
          : { type: 'quality', imageUrl: img.url };
      const res = await api.post<{ data: { enhancedUrl: string; elapsedMs: number } }>(
        '/products/replicate/enhance-image',
        body,
      );
      const enhancedUrl = res.data.data.enhancedUrl;
      setEnhanceCache((prev) => ({ ...prev, [cacheKey]: enhancedUrl }));
      setEnhanceState((s) =>
        s && s.imgId === img.id ? { ...s, status: 'preview', enhancedUrl } : s,
      );
    } catch (err) {
      setEnhanceState((s) =>
        s && s.imgId === img.id ? { ...s, status: 'error', errorMsg: getApiError(err).message } : s,
      );
    }
  };

  // User picked the enhanced version from the comparison dialog. Mutate the
  // gallery entry in place so any approved/primary/back state stays attached
  // to this image, but the URL points at the Replicate result. We deliberately
  // keep `source` (the website name) intact and record the enhancement on a
  // separate `enhanced` field so the tile can show a Sparkles indicator
  // without losing the origin information.
  const applyEnhanced = (imgId: number, enhancedUrl: string, mode: EnhanceMode) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === imgId
          ? {
              ...img,
              url: enhancedUrl,
              thumbnailUrl: enhancedUrl,
              enhanced: {
                type: mode.type,
                prompt: mode.type === 'edit' ? mode.prompt : undefined,
              },
            }
          : img,
      ),
    );
  };

  return {
    enhanceResultsOpen,
    setEnhanceResultsOpen,
    enhanceTarget,
    setEnhanceTarget,
    enhanceState,
    setEnhanceState,
    afterImgLoaded,
    setAfterImgLoaded,
    bgRemoveState,
    setBgRemoveState,
    afterBgImgLoaded,
    setAfterBgImgLoaded,
    croppedIds,
    cropState,
    setCropState,
    originalUrlBeforeCrop,
    cropButtonLoadingId,
    runRemoveBackground,
    applyBgRemoved,
    revertBgRemoval,
    handleScissorsClick,
    handleCropClick,
    applyCrop,
    revertCrop,
    applyCropFromDialog,
    runEnhance,
    applyEnhanced,
    // cache/reset setters needed by the reset effect in useAiImagesSection
    setEnhanceCache,
    setBgRemovalCache,
    setOriginalUrlBeforeBg,
  };
}
