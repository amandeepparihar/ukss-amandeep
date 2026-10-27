/**
 * AiImagesSection — gallery + Dify image-search slice.
 * Extracted verbatim from AiGenerationPanel.tsx (no behaviour change): the
 * gallery image list, Dify fresh/find-more fetches, and upload/paste-URL
 * handlers. Consumed by useAiImagesSection.
 */

import { useState, useRef, useCallback } from 'react';
import { api, getApiError } from '@/lib/api';
import { toast } from 'sonner';
import { extractImages, type ExtractedImage } from '../utils/difyParse';
import type { ProductInfo, AiState, DifyApiResponse } from './aiGeneration.types';

export function useAiImageGallery({
  productInfo,
  saveToHistory,
}: {
  productInfo: ProductInfo | null | undefined;
  saveToHistory: () => void;
}) {
  // Configurable inputs (Dify workflow params)
  const numberOfKeywords = 3; // Fixed value - Keywords input hidden per requirement
  const [numberOfResults, setNumberOfResults] = useState(10);

  const [state, setState] = useState<AiState>('idle');

  // Live results from Dify
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Track latest fetch so a stale response can't overwrite a newer one
  const fetchTokenRef = useRef(0);

  // Find-More state: URLs already shown to the user (excluded from next fetch).
  // Stores BOTH `url` (upgraded) and `fallbackUrl` (original Serper URL) for each
  // image so canonical-URL match catches whichever variant the next Serper run returns.
  const [excludedUrls, setExcludedUrls] = useState<Set<string>>(new Set());
  // Every URL the user uploaded via the toolbar Upload button during this
  // session. Forwarded to Save Details so the backend can prune any uploads
  // the user didn't end up selecting (not primary, back, or additional).
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  // True when backend reports the candidate pool was already smaller than the
  // requested count, OR the picker returned fewer than requested. Disables Find More.
  const [exhausted, setExhausted] = useState(false);
  // True when backend lifted the <600px filter because the strict pool was empty.
  // Surfaces an amber "showing low-res images" indicator in the UI.
  const [dimensionFilterLifted, setDimensionFilterLifted] = useState(false);

  // Build the request payload shared by fresh and find-more.
  const buildRequestBody = (
    enhancementPrompt: string | undefined,
    extraExcludeUrls: string[],
  ) => {
    if (!productInfo) return null;
    return {
      productName: productInfo.productName,
      productCode: productInfo.productCode,
      team: productInfo.teamName || undefined,
      season: productInfo.season || undefined,
      manufacturerName: productInfo.manufacturerName || undefined,
      numberOfKeywords,
      numberOfResults,
      enhancementPrompt: enhancementPrompt || undefined,
      excludeUrls: extraExcludeUrls,
    };
  };

  // Fresh search: replaces the gallery. Used by product-change effect and by
  // the EnhanceDialog refinement prompt (which fundamentally changes intent).
  const runDifyFresh = async (enhancementPrompt?: string) => {
    if (!productInfo) return;
    const token = ++fetchTokenRef.current;
    setState('searching');
    setErrorMsg(null);

    const body = buildRequestBody(enhancementPrompt, []);
    if (!body) return;

    try {
      const res = await api.post<DifyApiResponse>('/products/dify/images', body);
      if (token !== fetchTokenRef.current) return; // stale response

      const outputs = res.data.data.outputs ?? {};
      const newImages = extractImages(outputs);
      setImages(newImages);
      // Reset excluded set to just the new batch's URLs.
      const nextExcluded = new Set<string>();
      newImages.forEach((i) => {
        nextExcluded.add(i.url);
        if (i.fallbackUrl) nextExcluded.add(i.fallbackUrl);
      });
      setExcludedUrls(nextExcluded);
      setExhausted(
        String(outputs.exhausted ?? 'no') === 'yes' ||
          newImages.length < numberOfResults,
      );
      setDimensionFilterLifted(String(outputs.dimension_filter_lifted ?? 'no') === 'yes');
      setState('results');
    } catch (err) {
      if (token !== fetchTokenRef.current) return;
      setErrorMsg(getApiError(err).message);
      setState('error');
    }
  };

  // Find More: appends new images to the gallery, excludes everything already shown.
  // Preserves user's approve/primary/back selections.
  const runDifyMore = async () => {
    if (!productInfo) return;
    const token = ++fetchTokenRef.current;
    setState('searching');
    setErrorMsg(null);

    const body = buildRequestBody(undefined, Array.from(excludedUrls));
    if (!body) return;

    try {
      const res = await api.post<DifyApiResponse>('/products/dify/images', body);
      if (token !== fetchTokenRef.current) return;

      const outputs = res.data.data.outputs ?? {};
      const newImages = extractImages(outputs);
      // Re-id new images so they don't collide with existing ids.
      const maxId = images.reduce((m, i) => Math.max(m, i.id), 0);
      const reIded = newImages.map((img, idx) => ({ ...img, id: maxId + idx + 1 }));
      setImages((prev) => [...prev, ...reIded]);
      setExcludedUrls((prev) => {
        const next = new Set(prev);
        reIded.forEach((i) => {
          next.add(i.url);
          if (i.fallbackUrl) next.add(i.fallbackUrl);
        });
        return next;
      });
      setExhausted(
        String(outputs.exhausted ?? 'no') === 'yes' || reIded.length === 0,
      );
      setDimensionFilterLifted(String(outputs.dimension_filter_lifted ?? 'no') === 'yes');
      setState('results');
    } catch (err) {
      if (token !== fetchTokenRef.current) return;
      setErrorMsg(getApiError(err).message);
      setState('error');
    }
  };

  // Configurable inputs panel — always shown above the results
  // Persist a user-supplied image via POST /api/products/upload-image. The
  // backend compresses to 1080×1080 JPEG and writes into the same dir Save
  // Details uses (`adtnl_prodts_img/upload_*.jpg`), then returns a CDN URL.
  // The returned URL is appended as an "Uploaded" gallery tile and tracked in
  // `uploadedImageUrls` so unselected uploads can be pruned at Save Details.
  const uploadGalleryImage = useCallback(
    async (file: File): Promise<{ url: string }> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<{ data: { url: string; filename: string; size: number } }>(
        '/products/upload-image',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return { url: res.data.data.url };
    },
    [],
  );

  // Shared "append a new tile to the gallery" helper. Drives both the file-
  // upload completion path and the paste-URL path so behaviour stays identical
  // (id allocation, exclusion set, exhausted reset).
  const appendGalleryTile = useCallback(
    (url: string, source: 'Uploaded' | 'URL') => {
      saveToHistory();
      setImages((prev) => {
        const maxId = prev.reduce((m, i) => Math.max(m, i.id), 0);
        const sameSourceCount = prev.filter((i) => i.source === source).length;
        const labelPrefix = source === 'Uploaded' ? 'Uploaded' : 'Pasted';
        const next: ExtractedImage = {
          id: maxId + 1,
          url,
          thumbnailUrl: url,
          source,
          label: `${labelPrefix} ${sameSourceCount + 1}`,
        };
        return [...prev, next];
      });
      setExcludedUrls((prev) => {
        const nextSet = new Set(prev);
        nextSet.add(url);
        return nextSet;
      });
      setExhausted(false);
      setState('results');
    },
    [],
  );

  const handleUploadComplete = useCallback(
    ({ url }: { url: string }) => {
      appendGalleryTile(url, 'Uploaded');
      // Track for prune-on-save. Selected uploads stay; unselected get deleted
      // from disk after a successful Save Details run (server-side check).
      setUploadedImageUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
      toast.success('Image uploaded');
    },
    [appendGalleryTile],
  );

  // Paste-by-URL state for the small popover in the Step 3 toolbar.
  const [pasteUrlOpen, setPasteUrlOpen] = useState(false);
  const [pasteUrlValue, setPasteUrlValue] = useState('');
  const [pasteUrlError, setPasteUrlError] = useState<string | null>(null);

  const handlePasteUrl = useCallback(() => {
    const raw = pasteUrlValue.trim();
    if (!raw) {
      setPasteUrlError('Enter an image URL');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      setPasteUrlError("That doesn't look like a valid URL");
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setPasteUrlError('URL must start with http:// or https://');
      return;
    }
    if (excludedUrls.has(raw)) {
      setPasteUrlError('That image is already in the gallery');
      return;
    }
    appendGalleryTile(raw, 'URL');
    toast.success('Image added');
    setPasteUrlValue('');
    setPasteUrlError(null);
    setPasteUrlOpen(false);
  }, [pasteUrlValue, excludedUrls, appendGalleryTile]);

  return {
    numberOfResults,
    setNumberOfResults,
    state,
    setState,
    images,
    setImages,
    errorMsg,
    setErrorMsg,
    fetchTokenRef,
    excludedUrls,
    setExcludedUrls,
    uploadedImageUrls,
    setUploadedImageUrls,
    exhausted,
    setExhausted,
    dimensionFilterLifted,
    setDimensionFilterLifted,
    buildRequestBody,
    runDifyFresh,
    runDifyMore,
    uploadGalleryImage,
    appendGalleryTile,
    handleUploadComplete,
    pasteUrlOpen,
    setPasteUrlOpen,
    pasteUrlValue,
    setPasteUrlValue,
    pasteUrlError,
    setPasteUrlError,
    handlePasteUrl,
  };
}
