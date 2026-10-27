/**
 * New Product Page — Full-width 5-step wizard.
 *
 * Steps (sequential unlock, all visible, collapsible):
 *  0. Barcode             — entry gate (always unlocked, mandatory)
 *  1. Product Details     — unlocked after step 0 resolved
 *  2. Add Inventory       — unlocked after step 1 saved
 *  3. Images              — unlocked after step 1 saved
 *  4. Description & Attributes — unlocked after step 1 saved
 *
 * Step 0 short-circuit: if the entered barcode already exists, we resolve to
 * the matching product via the shared productLookup helper and immediately
 * call handleProductSaved with the populated savedInfo — same end-state as
 * typing an existing product code in Step 1.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Loader2, Package, Save } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api, getApiError } from '@/lib/api';
import { ProductDetailsTab } from './components/ProductDetailsTab';
import { InventoryTab } from './components/InventoryTab';
import { BarcodeStep, type BarcodeResolution } from './components/BarcodeStep';
import { fetchProductLookupByCode } from './utils/productLookup';
import {
  AiImagesSection,
  AiDescriptionSection,
  type ImagesState,
  type DescriptionState,
} from './components/AiGenerationPanel';

// ---------------------------------------------------------------------------
// Step header component
// ---------------------------------------------------------------------------

type StepStatus = 'pending' | 'active' | 'done';

function StepHeader({
  step,
  title,
  status,
  isOpen,
  onToggle,
  summary,
  extra,
}: {
  step: number;
  title: string;
  status: StepStatus;
  isOpen: boolean;
  onToggle?: () => void;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const isPending = status === 'pending';

  return (
    <button
      type="button"
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
        isPending ? 'cursor-default' : 'hover:bg-muted/40',
      )}
      onClick={!isPending ? onToggle : undefined}
      disabled={isPending}
    >
      {/* Step circle */}
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
          status === 'done' && 'bg-green-600 text-white',
          status === 'active' && 'bg-primary text-primary-foreground',
          status === 'pending' && 'border border-muted-foreground/30 text-muted-foreground/50',
        )}
      >
        {status === 'done' ? <Check className="h-3.5 w-3.5" /> : step}
      </span>

      {/* Title + summary */}
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            'text-sm font-semibold leading-none',
            isPending && 'text-muted-foreground/50',
          )}
        >
          {title}
        </span>
        {summary && (
          <div className="mt-0.5 truncate">{summary}</div>
        )}
      </div>

      {extra}

      {/* Chevron */}
      {!isPending && (
        <span className="text-muted-foreground ml-1 shrink-0">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Wizard section wrapper
// ---------------------------------------------------------------------------

function WizardSection({
  step,
  title,
  status,
  isOpen,
  onToggle,
  summary,
  extra,
  children,
}: {
  step: number;
  title: string;
  status: StepStatus;
  isOpen: boolean;
  onToggle?: () => void;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden bg-white',
        status === 'done' && !isOpen && 'border-green-200 bg-green-50/20',
        status === 'active' && 'border-primary/30 shadow-sm',
        status === 'pending' && 'border-muted opacity-60',
      )}
    >
      <StepHeader
        step={step}
        title={title}
        status={status}
        isOpen={isOpen}
        onToggle={onToggle}
        summary={summary}
        extra={extra}
      />
      {/* Use CSS visibility to keep children mounted and preserve state (e.g., cached search results) */}
      <div className={cn("border-t px-4 pb-4 pt-3", !isOpen && "hidden")}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function NewProductPage() {
  const [productListsId, setProductListsId] = useState<number | null>(null);

  // Step 0 state — barcode gate
  const [barcodeResolution, setBarcodeResolution] = useState<BarcodeResolution | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(true);

  // Step 1 state
  const [isEditingDetails, setIsEditingDetails] = useState(true);
  const [codeStatus, setCodeStatus] = useState<'new' | 'existing' | null>(null);
  const [savedProductInfo, setSavedProductInfo] = useState<{
    productCode: string;
    productName: string;
    teamName: string;
    season: string;
    price: number;
    productTypeId: string;
    productTypeName?: string;
    manufacturerName?: string;
    frontImage: string;
    backImage: string;
    additionalImage: string;
    // Pre-populated from check-code for existing products. Steps 3 & 4 read
    // these to seed local state and skip auto-Dify.
    codeStatus?: 'new' | 'existing';
    descriptionNotes?: string;
    productAttributes?: Record<string, string>;
    savedPrimaryImageUrl?: string | null;
    savedAdditionalImageUrls?: string[];
    savedBackImageUrl?: string | null;
    /** Backed by product_lists.allows_personalisation. Step 4 forwards this
     *  to the Dify description workflow as the add_legends gate. */
    allowsPersonalisation?: boolean;
    countryOfOriginId?: number | null;
    countryOfOriginName?: string;
    /** product_lists.hs_code — threaded through to Steps 3 and 4 alongside the
     *  country of origin (PMS #166509). */
    hsCode?: string | null;
  } | null>(null);

  // Step 2 done state
  const [inventoryDone, setInventoryDone] = useState(false);

  // Step 3 & 4 state from child components (exposed via onStateChange)
  const [imagesState, setImagesState] = useState<ImagesState>({
    primaryImageUrl: null,
    backImageUrl: null,
    additionalImageUrls: [],
    approvedCount: 0,
    removeBackgroundForPrimary: false,
    removeBackgroundForBack: false,
    removeBackgroundImageUrls: [],
    manualCropForPrimary: false,
    manualCropForBack: false,
    manualCropImageUrls: [],
    manualCropOriginals: {},
    galleryImages: [],
    uploadedImageUrls: [],
  });
  const [descriptionState, setDescriptionState] = useState<DescriptionState>({
    descriptionText: '',
    descriptionAccepted: false,
    acceptedAttributes: {},
  });
  const [isSaving, setIsSaving] = useState(false);

  // Stable callbacks so child components don't re-render excessively
  const handleImagesStateChange = useCallback((s: ImagesState) => setImagesState(s), []);
  const handleDescriptionStateChange = useCallback((s: DescriptionState) => setDescriptionState(s), []);

  // Per-section open/collapsed
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [imagesOpen, setImagesOpen] = useState(true);
  const [descOpen, setDescOpen] = useState(true);

  // ── URL pre-fill (used by the Deliveries grid's "Edit on Stock2 New Product"
  // and "Upload Image" links, which navigate to
  //   /products/new?pcode=<code>            → pre-fill the wizard, then sit on inventory
  //   /products/new?pcode=<code>&step=images → same + jump straight to Step 3
  // We deliberately reuse the same resolution path the barcode scanner uses,
  // so an existing pcode produces the exact same wizard end-state as a
  // successful barcode scan.
  const [searchParams] = useSearchParams();
  const urlPcode = (searchParams.get('pcode') || '').trim();
  const urlStep = (searchParams.get('step') || '').trim();

  // Product types — same query BarcodeStep uses. We need this to populate
  // SavedProductInfo.productTypeName when resolving an existing product.
  const { data: productTypesData } = useQuery({
    queryKey: ['products', 'product-types'],
    queryFn: async () => {
      const res = await api.get('/products/product-types');
      return res.data.data as Array<{ type_id: number; type_name: string }>;
    },
  });

  // Step 3 anchor — used to scroll the Images section into view when the URL
  // says `step=images` (Upload Image button on the deliveries grid).
  const imagesSectionRef = useRef<HTMLDivElement | null>(null);

  // One-shot guard. If the operator changes the barcode mid-flow we don't
  // want this effect re-firing and clobbering their reset.
  const urlPrefillTriedRef = useRef(false);

  const handleProductSaved = (
    id: number,
    info?: {
      productCode: string; productName: string; teamName: string; season: string;
      price: number; productTypeId: string;
      productTypeName?: string;
      manufacturerName?: string;
      frontImage: string; backImage: string; additionalImage: string;
      codeStatus?: 'new' | 'existing';
      descriptionNotes?: string;
      productAttributes?: Record<string, string>;
      savedPrimaryImageUrl?: string | null;
      savedAdditionalImageUrls?: string[];
      savedBackImageUrl?: string | null;
      allowsPersonalisation?: boolean;
      countryOfOriginId?: number | null;
      countryOfOriginName?: string;
      hsCode?: string | null;
    },
  ) => {
    setProductListsId(id);
    setIsEditingDetails(false);
    if (info) {
      setSavedProductInfo(info);
      if (info.codeStatus) setCodeStatus(info.codeStatus);
    }
    // Collapse product details, open inventory
    setDetailsOpen(false);
    setInventoryOpen(true);
  };

  const handleCancelEdit = () => {
    setIsEditingDetails(false);
    setDetailsOpen(false);
  };

  // Step 0: barcode resolved.
  //  - Existing barcode → reuse the same end-state as typing an existing code
  //    in Step 1 by feeding savedInfo straight into handleProductSaved.
  //  - New barcode → open Step 1 with an empty form so the user can enter
  //    product details from scratch. Step 0 and Step 2 barcodes are
  //    intentionally independent (Step 2's per-size barcode is unaffected).
  const handleBarcodeResolved = (result: BarcodeResolution) => {
    setBarcodeResolution(result);
    setBarcodeOpen(false);
    if (result.codeStatus === 'existing') {
      handleProductSaved(result.productListsId, result.savedInfo);
    } else {
      setDetailsOpen(true);
      setIsEditingDetails(true);
    }
  };

  const handleBarcodeReset = () => {
    // Changing the barcode after a product has been touched discards the
    // wizard state — confirm before clobbering.
    if (productListsId !== null) {
      const ok = window.confirm(
        'Changing the barcode will reset the rest of the wizard. Continue?',
      );
      if (!ok) return;
    }
    setBarcodeResolution(null);
    setProductListsId(null);
    setSavedProductInfo(null);
    setCodeStatus(null);
    setIsEditingDetails(true);
    setInventoryDone(false);
    setBarcodeOpen(true);
    setDetailsOpen(true);
  };

  const handleInventoryFinished = () => {
    setInventoryDone(true);
    setInventoryOpen(false);
  };

  // Run the URL pre-fill once both pcode is present and product types are
  // loaded. The pcode comes from the Deliveries grid (E badge / Upload Image
  // button); on success we feed handleBarcodeResolved a synthetic
  // BarcodeResolution so the rest of the wizard light up exactly as if the
  // user had scanned the matching barcode.
  useEffect(() => {
    if (!urlPcode || urlPrefillTriedRef.current) return;
    if (!productTypesData) return; // wait for the types lookup so productTypeName resolves
    urlPrefillTriedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const lookup = await fetchProductLookupByCode(urlPcode, productTypesData);
        if (cancelled) return;
        if (lookup.codeStatus !== 'existing') {
          toast.error(`Product code ${urlPcode} not found — enter a barcode to continue.`);
          return;
        }
        // Synthesize a BarcodeResolution. We don't have the actual barcode
        // string from a pcode-based entry, so the resolved-view summary will
        // show the pcode itself; that matches operator intent ("I came in
        // editing JZ5773") and keeps Step 0's resolved-view contract intact.
        handleBarcodeResolved({
          codeStatus: 'existing',
          barcode: urlPcode,
          productListsId: lookup.productListsId,
          savedInfo: lookup.savedInfo,
        });
        // For ?step=images, collapse the inventory step and bring Step 3 into
        // view. handleProductSaved (called via handleBarcodeResolved) opens
        // inventory by default — we override that here. Scroll on a microtask
        // so the section has rendered with its new state first.
        if (urlStep === 'images') {
          setInventoryOpen(false);
          setImagesOpen(true);
          requestAnimationFrame(() => {
            imagesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
      } catch (err) {
        if (cancelled) return;
        toast.error(getApiError(err).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urlPcode, urlStep, productTypesData]);

  // Save Details handler — sends approved images + description to the API
  const handleSaveDetails = async () => {
    if (!productListsId || !savedProductInfo) return;

    // Validation: primary image, at least one approved image, and accepted description
    if (!imagesState.primaryImageUrl) {
      toast.error('Please mark at least one image as primary before saving.');
      return;
    }
    if (imagesState.approvedCount === 0) {
      toast.error('Please approve at least one image before saving.');
      return;
    }
    if (!descriptionState.descriptionAccepted || !descriptionState.descriptionText.trim()) {
      toast.error('Please accept a description with content before saving.');
      return;
    }
    if (Object.keys(descriptionState.acceptedAttributes).length === 0) {
      toast.error('Please accept at least one attribute before saving.');
      return;
    }

    setIsSaving(true);
    try {
      await api.post('/products/save-details', {
        productListsId,
        productCode: savedProductInfo.productCode,
        primaryImageUrl: imagesState.primaryImageUrl,
        backImageUrl: imagesState.backImageUrl,
        additionalImageUrls: imagesState.additionalImageUrls,
        descriptionNotes: descriptionState.descriptionAccepted ? descriptionState.descriptionText : '',
        productAttributes: descriptionState.acceptedAttributes,
        // Background removal flags
        removeBackgroundForPrimary: imagesState.removeBackgroundForPrimary,
        removeBackgroundForBack: imagesState.removeBackgroundForBack,
        removeBackgroundImageUrls: imagesState.removeBackgroundImageUrls,
        // Manual crop flags — cropped tiles skip auto-trim; originals map lets
        // the backend persist the un-cropped source for later re-crops.
        manualCropForPrimary: imagesState.manualCropForPrimary,
        manualCropForBack: imagesState.manualCropForBack,
        manualCropImageUrls: imagesState.manualCropImageUrls,
        manualCropOriginals: imagesState.manualCropOriginals,
        // Forwarded so the backend can prune uploaded tiles the user didn't
        // end up selecting (not primary, back, or additional).
        uploadedImageUrls: imagesState.uploadedImageUrls,
      });
      toast.success('Details saved successfully');
    } catch (err) {
      toast.error(getApiError(err).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Derive step statuses
  const step0Status: StepStatus = barcodeResolution ? 'done' : 'active';
  const step1Status: StepStatus = !barcodeResolution
    ? 'pending'
    : productListsId
      ? isEditingDetails ? 'active' : 'done'
      : 'active';
  const step2Status: StepStatus = !productListsId ? 'pending' : inventoryDone ? 'done' : 'active';
  const step3Status: StepStatus = !productListsId ? 'pending' : 'active';
  const step4Status: StepStatus = !productListsId ? 'pending' : 'active';

  // Step 1 summary (shown when collapsed and saved)
  const step1Summary = savedProductInfo && !isEditingDetails ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Package className="h-3 w-3" />
        <span className="font-medium text-foreground">{savedProductInfo.productCode}</span>
      </span>
      {savedProductInfo.productName && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {savedProductInfo.productName}
        </span>
      )}
      {savedProductInfo.teamName && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          {savedProductInfo.teamName}
        </Badge>
      )}
      {savedProductInfo.season && (
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {savedProductInfo.season}
        </Badge>
      )}
    </div>
  ) : undefined;

  // Code status badge shown in step 1 header when done (click header to expand/edit)
  const step1Extra = step1Status === 'done' && !isEditingDetails ? (
    <div className="flex items-center gap-2 shrink-0">
      {codeStatus === 'existing' && (
        <Badge variant="secondary" className="text-xs">Existing product</Badge>
      )}
      {codeStatus === 'new' && (
        <Badge variant="outline" className="text-xs">New product</Badge>
      )}
    </div>
  ) : undefined;

  return (
    <div className="space-y-3">
      <PageHeader
        title="New Product"
        description="Create product codes and manage size-level inventory"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'New Product' }]}
      />

      <div className="space-y-2">
        {/* ── Step 0: Barcode ── */}
        <WizardSection
          step={0}
          title="Barcode"
          status={step0Status}
          isOpen={barcodeOpen}
          onToggle={() => setBarcodeOpen((o) => !o)}
          summary={
            barcodeResolution ? (
              <span className="text-xs text-muted-foreground">
                {barcodeResolution.codeStatus === 'existing'
                  ? `Existing product — ${barcodeResolution.savedInfo.productCode}`
                  : 'New barcode — fill product details in Step 1'}
              </span>
            ) : undefined
          }
        >
          <BarcodeStep
            resolvedBarcode={barcodeResolution?.barcode ?? null}
            resolution={barcodeResolution}
            onResolved={handleBarcodeResolved}
            onReset={handleBarcodeReset}
          />
        </WizardSection>

        {/* ── Step 1: Product Details ── */}
        <WizardSection
          step={1}
          title="Product Details"
          status={step1Status}
          isOpen={!!barcodeResolution && detailsOpen}
          onToggle={() => {
            const opening = !detailsOpen;
            setDetailsOpen(opening);
            // Re-enter edit mode when expanding after save
            if (opening && step1Status === 'done') setIsEditingDetails(true);
          }}
          summary={step1Summary}
          extra={step1Extra}
        >
          {/* Always mounted — CSS visibility preserves React Hook Form state */}
          <div className={isEditingDetails ? '' : 'hidden'}>
            <ProductDetailsTab
              productListsId={productListsId}
              onProductSaved={handleProductSaved}
              onCancel={productListsId ? handleCancelEdit : undefined}
              savedInfo={savedProductInfo ?? undefined}
            />
          </div>
          {!isEditingDetails && (
            <div className="text-xs text-muted-foreground py-1">
              Product details saved. Click to expand and modify.
            </div>
          )}
        </WizardSection>

        {/* ── Step 2: Add Inventory ── */}
        <WizardSection
          step={2}
          title="Add Inventory"
          status={step2Status}
          isOpen={!!productListsId && inventoryOpen}
          onToggle={() => setInventoryOpen((o) => !o)}
        >
          {productListsId && (
            <InventoryTab
              productListsId={productListsId}
              onFinished={handleInventoryFinished}
              // Seed the inventory barcode only for the brand-new-barcode path.
              // For an existing barcode the parent product already has its own
              // inventory barcodes, so a pre-fill would just be misleading.
              initialBarcode={
                barcodeResolution?.codeStatus === 'new' ? barcodeResolution.barcode : undefined
              }
            />
          )}
        </WizardSection>

        {/* ── Step 3: Images ── */}
        <div ref={imagesSectionRef}>
          <WizardSection
            step={3}
            title="Images"
            status={step3Status}
            isOpen={!!productListsId && imagesOpen}
            onToggle={() => setImagesOpen((o) => !o)}
          >
            <AiImagesSection
              productListsId={productListsId}
              productInfo={savedProductInfo}
              onStateChange={handleImagesStateChange}
            />
          </WizardSection>
        </div>

        {/* ── Step 4: Description & Attributes ── */}
        <WizardSection
          step={4}
          title="Description & Attributes"
          status={step4Status}
          isOpen={!!productListsId && descOpen}
          onToggle={() => setDescOpen((o) => !o)}
        >
          <AiDescriptionSection
            productListsId={productListsId}
            productInfo={savedProductInfo}
            availableImages={[
              ...(imagesState.primaryImageUrl
                ? [{ url: imagesState.primaryImageUrl, label: 'Primary' }]
                : []),
              ...(imagesState.backImageUrl
                ? [{ url: imagesState.backImageUrl, label: 'Back' }]
                : []),
              ...imagesState.additionalImageUrls.map((url, i) => ({
                url,
                label: `Additional ${i + 1}`,
              })),
            ]}
            onStateChange={handleDescriptionStateChange}
          />
        </WizardSection>
      </div>

      {/* Save Details — bottom CTA, only shown once product exists */}
      {productListsId && (
        <div className="flex justify-end pt-2 pb-4">
          <Button
            type="button"
            size="lg"
            onClick={handleSaveDetails}
            disabled={isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSaving ? 'Saving…' : 'Save Details'}
          </Button>
        </div>
      )}
    </div>
  );
}