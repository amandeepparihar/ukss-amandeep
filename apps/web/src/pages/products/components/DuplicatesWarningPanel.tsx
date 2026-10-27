/**
 * DuplicatesWarningPanel — surfaces possible duplicate products detected before
 * a new product is saved (Product Automation Improvement — Robert's Brazil case).
 *
 * Renders the ranked candidate list returned by POST /products/check-duplicates,
 * spanning BOTH active and archived products, so the operator no longer has to
 * manually search two lists. When a strong candidate exists the parent gates
 * Save behind the acknowledgement checkbox rendered here.
 */

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface DuplicateCandidate {
  productListsId: number;
  productCode: string;
  productName: string | null;
  teamName: string | null;
  season: string | null;
  productTypeName: string | null;
  ageGroup: string | null;
  color: string | null;
  status: 'active' | 'archived' | 'unmapped';
  frontImageUrl: string | null;
  matchScore: number;
  strength: 'strong' | 'weak';
  matchSource: 'structured' | 'fuzzy' | 'both';
  matchedFields: string[];
}

export interface CheckDuplicatesResult {
  candidates: DuplicateCandidate[];
  total: number;
  requiresAcknowledgement: boolean;
}

const STATUS_STYLES: Record<DuplicateCandidate['status'], string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  archived: 'bg-amber-100 text-amber-800 border-amber-200',
  unmapped: 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_LABEL: Record<DuplicateCandidate['status'], string> = {
  active: 'Active',
  archived: 'Archived',
  unmapped: 'Draft',
};

interface DuplicatesWarningPanelProps {
  result: CheckDuplicatesResult;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
}

export function DuplicatesWarningPanel({
  result,
  acknowledged,
  onAcknowledgedChange,
}: DuplicatesWarningPanelProps) {
  const { candidates, total, requiresAcknowledgement } = result;
  if (candidates.length === 0) return null;

  const shownExtra = total > candidates.length ? total - candidates.length : 0;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {total} possible duplicate{total === 1 ? '' : 's'} found
          </p>
          <p className="text-xs text-amber-800/80">
            These existing products (active &amp; archived) share the same team, season and type.
            Review them before creating a new product.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {candidates.map((c) => (
          <li
            key={c.productCode}
            className="flex items-center gap-2.5 rounded-md border border-amber-200 bg-white px-2.5 py-1.5"
          >
            {c.frontImageUrl ? (
              <img
                src={c.frontImageUrl}
                alt={c.productName ?? c.productCode}
                className="h-9 w-9 rounded object-cover border shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="h-9 w-9 rounded bg-muted shrink-0" />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{c.productCode}</span>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border font-medium',
                    STATUS_STYLES[c.status],
                  )}
                >
                  {STATUS_LABEL[c.status]}
                </span>
                {c.strength === 'strong' && (
                  <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                    Strong match
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{c.productName || '—'}</p>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {[c.teamName, c.season, c.productTypeName, c.color, c.ageGroup]
                  .filter((v): v is string => !!v)
                  .map((v, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] h-4 px-1.5">
                      {v}
                    </Badge>
                  ))}
              </div>
            </div>

            <a
              href={`/products/new?pcode=${encodeURIComponent(c.productCode)}`}
              target="_blank"
              rel="noreferrer"
              className="text-amber-700 hover:text-amber-900 shrink-0"
              title="Open this product"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </li>
        ))}
      </ul>

      {shownExtra > 0 && (
        <p className="text-[11px] text-amber-800/70">
          + {shownExtra} more with the same team/season/type — refine the attributes to narrow.
        </p>
      )}

      {requiresAcknowledgement && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-white px-2.5 py-2 cursor-pointer">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
            className="mt-0.5"
          />
          <span className="text-xs text-amber-900">
            I've reviewed the products above and confirm this is a <strong>new</strong> product,
            not a duplicate.
          </span>
        </label>
      )}
    </div>
  );
}
