/**
 * AiImagesSection — controller hook. Owns image-selection state (approve /
 * primary / back / bg-removal ids) + undo-redo history + the two cross-cutting
 * effects (reset/seed on product change, and the onStateChange notifier), and
 * composes the gallery + editing slices. Extracted verbatim from
 * AiGenerationPanel.tsx (no behaviour change) — same state, same effects, same
 * dependency arrays; only the file boundary is new.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { type ExtractedImage } from '../utils/difyParse';
import type { ProductInfo, ImagesState, ImageSelectionSnapshot } from './aiGeneration.types';
import { useAiImageGallery } from './useAiImageGallery';
import { useAiImageEditing } from './useAiImageEditing';

export function useAiImagesSection({
  productListsId,
  productInfo,
  onStateChange,
}: {
  productListsId: number | null;
  productInfo: ProductInfo | null | undefined;
  onStateChange?: (state: ImagesState) => void;
}) {
  const [approvedIds, setApprovedIds] = useState<Set<number>>(new Set());
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [backId, setBackId] = useState<number | null>(null);
  const [removeBackgroundIds, setRemoveBackgroundIds] = useState<Set<number>>(new Set());

  // Undo/Redo for image selections - using a simple history array
  const historyRef = useRef<ImageSelectionSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Save current state to history (called before making changes)
  const saveToHistory = useCallback(() => {
    const snapshot: ImageSelectionSnapshot = {
      approvedIds: Array.from(approvedIds),
      primaryId,
      backId,
      removeBackgroundIds: Array.from(removeBackgroundIds),
    };

    // Truncate any redo history when making a new change
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);

    // Limit to 50 entries
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }

    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, [approvedIds, primaryId, backId, removeBackgroundIds]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const snapshot = historyRef.current[historyIndexRef.current];

    setApprovedIds(new Set(snapshot.approvedIds));
    setPrimaryId(snapshot.primaryId);
    setBackId(snapshot.backId);
    setRemoveBackgroundIds(new Set(snapshot.removeBackgroundIds));

    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const snapshot = historyRef.current[historyIndexRef.current];

    setApprovedIds(new Set(snapshot.approvedIds));
    setPrimaryId(snapshot.primaryId);
    setBackId(snapshot.backId);
    setRemoveBackgroundIds(new Set(snapshot.removeBackgroundIds));

    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // Full-screen viewer for either before/after image — opened by clicking a
  // ZoomableImage in the comparison dialog.
  const [fullScreenImg, setFullScreenImg] = useState<{ url: string; label: string } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<ExtractedImage | null>(null);
  const [activeSourceFilter, setActiveSourceFilter] = useState<string | null>(null);
  const [moreSourcesOpen, setMoreSourcesOpen] = useState(false);

  const gallery = useAiImageGallery({ productInfo, saveToHistory });
  const editing = useAiImageEditing({
    setImages: gallery.setImages,
    removeBackgroundIds,
    setRemoveBackgroundIds,
  });

  const { images, uploadedImageUrls } = gallery;
  const { croppedIds, originalUrlBeforeCrop } = editing;

  useEffect(() => {
    if (!productListsId || !productInfo) {
      gallery.setState('idle');
      setApprovedIds(new Set());
      setPrimaryId(null);
      setBackId(null);
      setRemoveBackgroundIds(new Set());
      gallery.setImages([]);
      editing.setEnhanceCache({});
      editing.setEnhanceState(null);
      editing.setEnhanceTarget(null);
      editing.setAfterImgLoaded(false);
      editing.setBgRemovalCache({});
      editing.setBgRemoveState(null);
      editing.setAfterBgImgLoaded(false);
      editing.setOriginalUrlBeforeBg({});
      gallery.setErrorMsg(null);
      gallery.setExcludedUrls(new Set());
      gallery.setExhausted(false);
      gallery.setDimensionFilterLifted(false);
      gallery.setUploadedImageUrls([]);
      return;
    }

    // Existing product with previously-saved images: seed the tile grid from
    // saved CDN URLs and skip the Dify auto-call. The user can still trigger
    // a fresh batch via "Find More" in the section toolbar — saved URLs are
    // pre-loaded into the excluded set so they won't reappear.
    if (productInfo.codeStatus === 'existing' && productInfo.savedPrimaryImageUrl) {
      const seeded: ExtractedImage[] = [
        {
          id: 1,
          url: productInfo.savedPrimaryImageUrl,
          thumbnailUrl: productInfo.savedPrimaryImageUrl,
          source: 'Saved',
          label: 'Primary (saved)',
        },
        ...(productInfo.savedAdditionalImageUrls ?? []).map((u, i): ExtractedImage => ({
          id: i + 2,
          url: u,
          thumbnailUrl: u,
          source: 'Saved',
          label: `Saved ${i + 1}`,
        })),
      ];
      gallery.setImages(seeded);
      setPrimaryId(1);
      // Restore the Back button for the previously-saved back image. Its CDN URL
      // matches the corresponding entry already present in savedAdditionalImageUrls
      // (the back filename is prepended into the same additional-images CSV).
      const savedBack = productInfo.savedBackImageUrl;
      if (savedBack) {
        const backTile = seeded.find((s) => s.url === savedBack);
        if (backTile) setBackId(backTile.id);
      }
      setApprovedIds(new Set(seeded.map((s) => s.id)));
      gallery.setExcludedUrls(new Set(seeded.map((s) => s.url)));
      gallery.setExhausted(false);
      gallery.setDimensionFilterLifted(false);
      gallery.setState('results');
      return;
    }

    gallery.runDifyFresh();
    // Re-run only when the product itself changes — not on knob tweaks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productListsId]);

  // Notify parent when approval state changes
  useEffect(() => {
    if (!onStateChange) return;
    const primary = primaryId != null ? images.find((i) => i.id === primaryId) : null;
    const back = backId != null ? images.find((i) => i.id === backId) : null;
    const additional = images.filter(
      (i) => approvedIds.has(i.id) && i.id !== primaryId && i.id !== backId,
    );
    // Build list of additional image URLs marked for background removal
    const bgRemovalUrls = additional
      .filter((i) => removeBackgroundIds.has(i.id))
      .map((i) => i.url);
    // Manual crop payload: cropped additional URLs + a map of each cropped tile
    // URL → its pre-crop source (so the backend can persist the original).
    const manualCropUrls = additional
      .filter((i) => croppedIds.has(i.id))
      .map((i) => i.url);
    const manualCropOriginals: Record<string, string> = {};
    const recordCropOriginal = (img: ExtractedImage | null | undefined) => {
      if (!img || !croppedIds.has(img.id)) return;
      const original = originalUrlBeforeCrop[img.id];
      if (original) manualCropOriginals[img.url] = original;
    };
    recordCropOriginal(primary);
    recordCropOriginal(back);
    additional.forEach(recordCropOriginal);
    onStateChange({
      primaryImageUrl: primary?.url ?? null,
      backImageUrl: back?.url ?? null,
      additionalImageUrls: additional.map((i) => i.url),
      approvedCount: approvedIds.size,
      removeBackgroundForPrimary: primaryId != null && removeBackgroundIds.has(primaryId),
      removeBackgroundForBack: backId != null && removeBackgroundIds.has(backId),
      removeBackgroundImageUrls: bgRemovalUrls,
      manualCropForPrimary: primaryId != null && croppedIds.has(primaryId),
      manualCropForBack: backId != null && croppedIds.has(backId),
      manualCropImageUrls: manualCropUrls,
      manualCropOriginals,
      // Surface the full gallery (not just selected) so downstream sections
      // — currently the Enhance Description picker — can offer any tile as a
      // reference image for the vision LLM.
      galleryImages: images.map((img) => ({
        url: img.url,
        label: img.label,
        fallbackUrl: img.fallbackUrl,
        source: img.source,
      })),
      uploadedImageUrls,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedIds, primaryId, backId, removeBackgroundIds, croppedIds, originalUrlBeforeCrop, images, uploadedImageUrls]);

  const toggleApprove = (id: number) => {
    saveToHistory();
    setApprovedIds((prev) => {
      const next = new Set(prev);
      prev.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const togglePrimary = (id: number) => {
    saveToHistory();
    if (primaryId === id) {
      setPrimaryId(null);
    } else {
      setPrimaryId(id);
      // Same image cannot be both primary and back
      if (backId === id) setBackId(null);
      // Auto-approve when marking as primary
      setApprovedIds((prev) => new Set(prev).add(id));
    }
  };

  const toggleBack = (id: number) => {
    saveToHistory();
    if (backId === id) {
      setBackId(null);
    } else {
      setBackId(id);
      // Same image cannot be both primary and back
      if (primaryId === id) setPrimaryId(null);
      // Auto-approve when marking as back
      setApprovedIds((prev) => new Set(prev).add(id));
    }
  };

  return {
    productInfo,
    // selection + history
    approvedIds,
    primaryId,
    backId,
    removeBackgroundIds,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    toggleApprove,
    togglePrimary,
    toggleBack,
    // misc UI
    fullScreenImg,
    setFullScreenImg,
    lightboxImage,
    setLightboxImage,
    activeSourceFilter,
    setActiveSourceFilter,
    moreSourcesOpen,
    setMoreSourcesOpen,
    // gallery + editing slices
    ...gallery,
    ...editing,
  };
}

export type AiImagesController = ReturnType<typeof useAiImagesSection>;
