/**
 * AiDescriptionSection — the wizard's Step 4 (AI description + attributes).
 * Extracted verbatim from AiGenerationPanel.tsx (no behaviour change). The two
 * output panels live in sibling presentational files; all state + Dify wiring
 * stays here unchanged.
 */

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, getApiError } from '@/lib/api';
import { descriptionHtmlToPlain } from '@admin/shared';
import { extractDescription } from '../utils/difyParse';
import { SectionToolbar } from './SectionToolbar';
import {
  EnhanceDialog,
  type EnhanceImageOption,
  type EnhanceImageRef,
} from './EnhanceDialog';
import { DEFAULT_ATTRIBUTES } from './aiGeneration.constants';
import type { AiState, ProductInfo, DescriptionState, DifyApiResponse } from './aiGeneration.types';
import { DescriptionEditorPanel } from './DescriptionEditorPanel';
import { DescriptionAttributesPanel } from './DescriptionAttributesPanel';

export function AiDescriptionSection({
  productListsId,
  productInfo,
  availableImages,
  onStateChange,
}: {
  productListsId: number | null;
  productInfo: ProductInfo | null | undefined;
  /** Images the user has chosen in Step 3 (primary + back + additional).
   *  Surfaced in the Enhance Description dialog so the user can attach one
   *  or more as references for the vision-enabled LLM — handy when the
   *  initial run missed attributes the model could read off the photo
   *  (neckline, sleeve length, badges, sponsor logos). */
  availableImages?: EnhanceImageOption[];
  onStateChange?: (state: DescriptionState) => void;
}) {
  const [state, setState] = useState<AiState>('idle');
  const [descriptionText, setDescriptionText] = useState('');
  const [descriptionAccepted, setDescriptionAccepted] = useState(false);
  // Description renders formatted (markdown → the same HTML saved to the DB) by
  // default; toggle to plain-text editing. Reuses descriptionPlainToHtml so the
  // preview matches product_lists.description_notes exactly.
  const [descPreview, setDescPreview] = useState(true);
  // Attributes: selected values from dropdowns + AI suggested values for auto-matching
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [aiSuggestedAttrs, setAiSuggestedAttrs] = useState<Record<string, string>>({});
  // Per-attribute review messages from the Typesense disambiguation step in
  // the Dify workflow. A key is present here when the LLM picked a value
  // that didn't match any DB facet, so the user must pick manually.
  const [attrReviewMessages, setAttrReviewMessages] = useState<Record<string, string>>({});
  const [editingAttr, setEditingAttr] = useState<Record<string, boolean>>({});
  const [acceptedAttrs, setAcceptedAttrs] = useState<Set<string>>(new Set());
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fetchTokenRef = useRef(0);

  // Auto-grow the description textarea so it sizes to its content (no inner
  // scrollbar). The description column has plenty of vertical room next to
  // the attributes column, so use it instead of forcing a 8-row fixed height.
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = descTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // descPreview is a dep so height recomputes when switching back to Edit —
    // the textarea only mounts then, so scrollHeight isn't measurable earlier.
  }, [descriptionText, descPreview]);

  // Map workflow attribute keys to our dropdown keys (kept in sync with ATTRIBUTE_DROPDOWNS).
  const ATTR_KEY_MAPPING: Record<string, string> = {
    brand: 'manufacturer',
    primary_color: 'color',
    colour: 'color',
  };

  // Extract AI-suggested attribute values AND Typesense review messages
  // from the Dify workflow response.
  const extractAiSuggested = (
    outputs: Record<string, unknown>,
  ): { suggested: Record<string, string>; reviewMessages: Record<string, string> } => {
    const unwrapped = outputs.response && typeof outputs.response === 'object'
      ? outputs.response as Record<string, unknown>
      : outputs;

    const suggested: Record<string, string> = {};
    const attrs = unwrapped.attributes as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object') {
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === 'string' && value.trim()) {
          const mappedKey = ATTR_KEY_MAPPING[key] || key;
          suggested[mappedKey] = value.trim();
        }
      }
    }

    const reviewMessages: Record<string, string> = {};
    const review = unwrapped.attributes_review as
      | { needs_review?: unknown; messages?: Record<string, unknown> }
      | undefined;
    const messages = review?.messages;
    if (messages && typeof messages === 'object') {
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value === 'string' && value.trim()) {
          const mappedKey = ATTR_KEY_MAPPING[key] || key;
          reviewMessages[mappedKey] = value.trim();
        }
      }
    }

    return { suggested, reviewMessages };
  };

  // runDify updates description AND extracts AI suggested attributes for auto-matching.
  // Optional `referenceImageRefs` are forwarded to the vision-enabled GENERATE
  // DESCRIPTION node so the LLM can read attributes (neckline, sleeve length,
  // badges) directly off the photo when the text inputs were too sparse.
  // Each ref is either { url } (gallery pick / pasted URL) or { uploadFileId }
  // (Dify-side upload via POST /products/dify/upload-image).
  const runDify = async (enhancementPrompt?: string, referenceImageRefs?: EnhanceImageRef[]) => {
    if (!productInfo) return;
    const token = ++fetchTokenRef.current;
    setState('searching');
    setErrorMsg(null);
    try {
      const res = await api.post<DifyApiResponse>('/products/dify/description', {
        productName: productInfo.productName,
        productCode: productInfo.productCode,
        teamName: productInfo.teamName || undefined,
        season: productInfo.season || undefined,
        price: productInfo.price || undefined,
        enhancementPrompt: enhancementPrompt || undefined,
        images: referenceImageRefs && referenceImageRefs.length > 0 ? referenceImageRefs : undefined,
        // Step 1's "Personalize Product?" toggle. Workflow forces it off when
        // teamName is empty, so we don't gate on that here.
        addLegends: productInfo.allowsPersonalisation === true,
      });
      if (token !== fetchTokenRef.current) return;
      const outputs = res.data.data.outputs ?? {};
      const desc = extractDescription(outputs);
      setDescriptionText(desc);
      // Extract AI suggested attributes for auto-matching, plus Typesense
      // disambiguation messages for any value that didn't match a DB facet.
      const { suggested, reviewMessages } = extractAiSuggested(outputs);
      setAiSuggestedAttrs(suggested);
      setAttrReviewMessages(reviewMessages);
      setState('results');
    } catch (err) {
      if (token !== fetchTokenRef.current) return;
      setErrorMsg(getApiError(err).message);
      setState('error');
    }
  };

  useEffect(() => {
    if (!productListsId || !productInfo) {
      setState('idle');
      setDescriptionAccepted(false);
      setAcceptedAttrs(new Set());
      setDescriptionText('');
      setAttrReviewMessages({});
      // Note: Don't reset attrValues - they persist from dropdown selections
      setErrorMsg(null);
      return;
    }

    // Existing product with saved description and/or attributes: seed local
    // state from the saved record and skip the Dify auto-call. The user can
    // still trigger fresh AI output via the "Re-run" button in the toolbar.
    // Saved descriptions are stored as HTML (paragraphs + <ul><li>) so the
    // storefront preserves structure — convert back to wizard-format plain
    // text (`narrative\n\n• bullet`) for the textarea. Idempotent for any
    // legacy plain-text rows.
    const savedDescription = descriptionHtmlToPlain(productInfo.descriptionNotes ?? '').trim();
    const savedAttrs = productInfo.productAttributes ?? {};
    const hasSavedAttrs = Object.keys(savedAttrs).length > 0;
    if (productInfo.codeStatus === 'existing' && (savedDescription || hasSavedAttrs)) {
      if (savedDescription) {
        setDescriptionText(savedDescription);
        setDescriptionAccepted(true);
      }
      if (hasSavedAttrs) {
        setAttrValues((prev) => ({ ...prev, ...savedAttrs }));
        setAcceptedAttrs(new Set(Object.keys(savedAttrs)));
      }
      setState('results');
      return;
    }

    runDify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productListsId]);

  // Notify parent when description/acceptance/attributes change
  useEffect(() => {
    if (!onStateChange) return;
    const accepted: Record<string, string> = {};
    for (const key of acceptedAttrs) {
      accepted[key] = attrValues[key] ?? '';
    }
    onStateChange({ descriptionText, descriptionAccepted, acceptedAttributes: accepted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptionText, descriptionAccepted, acceptedAttrs, attrValues]);

  const toggleAttr = (key: string) =>
    setAcceptedAttrs((prev) => {
      const next = new Set(prev);
      prev.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Accept every attribute row that has a non-empty value. Empty rows are
  // skipped (matching the per-row Accept button which is disabled without a
  // value), so callers don't end up with junk empty-string entries in the
  // saved attribute payload.
  const acceptAllAttrs = () =>
    setAcceptedAttrs((prev) => {
      const next = new Set(prev);
      for (const attr of DEFAULT_ATTRIBUTES) {
        if (attrValues[attr.key]?.trim()) next.add(attr.key);
      }
      return next;
    });

  const unacceptAllAttrs = () =>
    setAcceptedAttrs((prev) => {
      const next = new Set(prev);
      for (const attr of DEFAULT_ATTRIBUTES) {
        if (attrValues[attr.key]?.trim()) next.delete(attr.key);
      }
      return next;
    });

  // Bulk row: accept every filled row not yet accepted; once all filled rows
  // are accepted, switch label/action to unaccept those same rows (mirrors
  // per-row Accept vs toggle behavior).
  const hasPendingAcceptAttr = DEFAULT_ATTRIBUTES.some(
    (a) => !!attrValues[a.key]?.trim() && !acceptedAttrs.has(a.key),
  );
  const hasAcceptedFilledAttr = DEFAULT_ATTRIBUTES.some(
    (a) => !!attrValues[a.key]?.trim() && acceptedAttrs.has(a.key),
  );
  const bulkAttrAction: 'accept' | 'unaccept' | 'none' = hasPendingAcceptAttr
    ? 'accept'
    : hasAcceptedFilledAttr
      ? 'unaccept'
      : 'none';

  const startEditingAttr = (key: string) =>
    setEditingAttr((prev) => ({ ...prev, [key]: true }));

  const stopEditingAttr = (key: string) =>
    setEditingAttr((prev) => ({ ...prev, [key]: false }));

  if (state === 'idle') {
    return (
      <p className="text-xs text-muted-foreground py-1">
        Save product details to generate AI description. Attributes are selected from dropdowns below.
      </p>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5 flex-1">
            <p className="font-medium">Description generation failed</p>
            <p className="text-red-600/80">{errorMsg}</p>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => runDify()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Note: We don't return early for 'searching' state anymore to keep attributes mounted

  return (
    <div className="space-y-3">
      {/* Enhance dialog */}
      <EnhanceDialog
        open={enhanceOpen}
        onOpenChange={setEnhanceOpen}
        title="Enhance Description"
        description="Provide instructions to improve the AI-generated description. Optionally attach product images — pick from the search results, paste an image URL, or upload a file. The vision-enabled AI reads attributes (neckline, sleeve length, badges, detailing) directly off the photo."
        placeholder="e.g. Make the description more SEO-friendly, focus on size guide and materials…"
        imageOptions={availableImages}
        enableCustomUpload
        onUploadFile={async (file) => {
          // Forward to the api proxy → Dify /files/upload. Returns the
          // upload_file_id which the dialog later embeds in the apply payload.
          const fd = new FormData();
          fd.append('file', file);
          const res = await api.post<{ data: { uploadFileId: string } }>(
            '/products/dify/upload-image',
            fd,
            { headers: { 'Content-Type': 'multipart/form-data' } },
          );
          return { uploadFileId: res.data.data.uploadFileId };
        }}
        onApply={(prompt, refs) => runDify(prompt, refs)}
      />

      {/* Toolbar — no Save button here; use the page-level Save Details */}
      <SectionToolbar
        onEnhance={() => setEnhanceOpen(true)}
        badge={
          acceptedAttrs.size > 0 ? (
            <Badge className="text-[10px] bg-blue-600 hover:bg-blue-600 ml-1">
              {acceptedAttrs.size} accepted
            </Badge>
          ) : undefined
        }
      />

      {/* Side-by-side: description left, attributes right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Generated description — shows loading or editable textarea */}
        <DescriptionEditorPanel
          state={state}
          descriptionAccepted={descriptionAccepted}
          setDescriptionAccepted={setDescriptionAccepted}
          descPreview={descPreview}
          setDescPreview={setDescPreview}
          descriptionText={descriptionText}
          setDescriptionText={setDescriptionText}
          descTextareaRef={descTextareaRef}
        />

        {/* Product attributes from database dropdowns */}
        <DescriptionAttributesPanel
          bulkAttrAction={bulkAttrAction}
          acceptAllAttrs={acceptAllAttrs}
          unacceptAllAttrs={unacceptAllAttrs}
          attrValues={attrValues}
          setAttrValues={setAttrValues}
          aiSuggestedAttrs={aiSuggestedAttrs}
          attrReviewMessages={attrReviewMessages}
          acceptedAttrs={acceptedAttrs}
          editingAttr={editingAttr}
          toggleAttr={toggleAttr}
          startEditingAttr={startEditingAttr}
          stopEditingAttr={stopEditingAttr}
        />
      </div>
    </div>
  );
}
