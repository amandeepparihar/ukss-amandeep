/**
 * Step 0 — Barcode gate.
 *
 * The wizard opens on this step. The user enters a barcode:
 *   - Existing barcode → resolves to the matching product code, fetches full
 *     details via the shared lookup helper, and surfaces them to the parent
 *     so Steps 1–4 auto-populate (mirrors today's existing-product-code flow).
 *   - New barcode → unlocks Step 1 with empty fields; the typed barcode is
 *     carried forward for the user's reference but is NOT linked to Step 2's
 *     per-size barcode inputs (they remain independent).
 *
 * Reuse: this component is a thin orchestrator over checkBarcode +
 * fetchProductLookupByCode from utils/productLookup. The same lookup helper
 * is used by ProductDetailsTab so a barcode-resolved product behaves
 * identically to a hand-typed product code.
 */

import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ScanBarcode, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api, getApiError } from '@/lib/api';
import { toast } from 'sonner';
import {
  fetchProductLookupByBarcode,
  type SavedProductInfo,
} from '../utils/productLookup';

export type BarcodeResolution =
  | { codeStatus: 'new'; barcode: string }
  | {
      codeStatus: 'existing';
      barcode: string;
      productListsId: number;
      savedInfo: SavedProductInfo;
    };

interface BarcodeStepProps {
  /** Currently resolved barcode (so the input stays controlled when collapsed/re-opened). */
  resolvedBarcode: string | null;
  /** Status from the last resolution; null means "not yet checked". */
  resolution: BarcodeResolution | null;
  /** Bubbles the resolution up to the parent wizard. */
  onResolved: (result: BarcodeResolution) => void;
  /** Allow the user to clear the resolution and re-enter a different barcode. */
  onReset: () => void;
}

const BARCODE_MAX_LEN = 13;

export function BarcodeStep({
  resolvedBarcode,
  resolution,
  onResolved,
  onReset,
}: BarcodeStepProps) {
  const [barcode, setBarcode] = useState(resolvedBarcode ?? '');
  const [isChecking, setIsChecking] = useState(false);
  // Synchronous in-flight guard so a blur+click sequence (blur fires before
  // click, both call handleCheck) doesn't issue two parallel lookups.
  const inFlightRef = useRef(false);
  // Last value we successfully kicked off a check for, so a blur after a
  // button click doesn't re-fire for the same input.
  const lastCheckedValueRef = useRef<string | null>(null);

  // Same query the form in Step 1 uses — react-query caches it so the second
  // mount is free. Needed so we can resolve productTypeName when an existing
  // barcode auto-populates Step 1.
  const { data: productTypesData } = useQuery({
    queryKey: ['products', 'product-types'],
    queryFn: async () => {
      const res = await api.get('/products/product-types');
      return res.data.data as Array<{ type_id: number; type_name: string }>;
    },
  });

  const handleCheck = useCallback(async () => {
    const trimmed = barcode.trim();
    if (!trimmed) {
      toast.error('Barcode is required');
      return;
    }
    if (trimmed.length > BARCODE_MAX_LEN) {
      toast.error(`Barcode must be ${BARCODE_MAX_LEN} characters or less`);
      return;
    }
    if (inFlightRef.current || lastCheckedValueRef.current === trimmed) return;
    inFlightRef.current = true;
    lastCheckedValueRef.current = trimmed;
    setIsChecking(true);
    try {
      const lookup = await fetchProductLookupByBarcode(trimmed, productTypesData);
      if (lookup.codeStatus === 'existing') {
        onResolved({
          codeStatus: 'existing',
          barcode: trimmed,
          productListsId: lookup.productListsId,
          savedInfo: lookup.savedInfo,
        });
        toast.success(`Existing product found: ${lookup.savedInfo.productCode}`);
      } else {
        onResolved({ codeStatus: 'new', barcode: trimmed });
      }
    } catch (err) {
      // Allow a retry of the same value if the request itself failed.
      lastCheckedValueRef.current = null;
      toast.error(getApiError(err).message);
    } finally {
      inFlightRef.current = false;
      setIsChecking(false);
    }
  }, [barcode, onResolved, productTypesData]);

  // Resolved view — compact summary with a "change barcode" affordance.
  if (resolution) {
    const isExisting = resolution.codeStatus === 'existing';
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <ScanBarcode className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{resolution.barcode}</span>
        </div>
        {isExisting ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Existing product — {resolution.savedInfo.productCode}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Sparkles className="h-3 w-3" />
            New barcode — fill product details below
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setBarcode('');
            onReset();
          }}
          className="ml-auto"
        >
          Change barcode
        </Button>
      </div>
    );
  }

  // Entry view.
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="barcode-step-input">Barcode</Label>
        <div className="flex gap-2">
          <Input
            id="barcode-step-input"
            placeholder="Scan or enter barcode"
            value={barcode}
            maxLength={BARCODE_MAX_LEN}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCheck();
              }
            }}
            onBlur={() => {
              // Auto-check on blur, mirroring the product-code field in Step 1.
              // Silent no-op on empty/in-flight so the user can leave the field
              // without seeing validation toasts they didn't ask for.
              if (!barcode.trim() || isChecking) return;
              void handleCheck();
            }}
            autoFocus
            disabled={isChecking}
          />
          <Button
            type="button"
            onClick={handleCheck}
            disabled={isChecking || !barcode.trim()}
            className="gap-2 shrink-0"
          >
            {isChecking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanBarcode className="h-4 w-4" />
            )}
            {isChecking ? 'Checking…' : 'Continue'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter the product barcode to begin. If it already exists, the rest of the form will be pre-filled.
        </p>
      </div>
    </div>
  );
}
