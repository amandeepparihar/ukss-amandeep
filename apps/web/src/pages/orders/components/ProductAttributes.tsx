/**
 * Product attributes display — size, badge, sponsor, and other attributes.
 * Requirements: REQ-05-004, REQ-05-007
 */

import type { ProductAttribute } from '../hooks/useOrderProducts';

interface ProductAttributesProps {
  attributes: ProductAttribute[];
  freeOffer: boolean;
}

export function ProductAttributes({
  attributes,
  freeOffer,
}: ProductAttributesProps) {
  if (attributes.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {attributes.map((attr) => {
        if (!attr.optionName) return null;

        const isSizeOption = attr.optionId === 1;
        const isBadgeOrSponsor =
          attr.optionName.toLowerCase().includes('badge logo') ||
          attr.optionName.toLowerCase().includes('sponsor logo');

        // REQ-05-007: Size attribute
        if (isSizeOption) {
          return (
            <div key={attr.id}>
              <span
                className={`cursor-pointer font-semibold uppercase underline ${
                  attr.sizeChanged ? 'text-red-600' : 'text-blue-600'
                }`}
                title="Click to change size (SPEC-06)"
              >
                {attr.optionValue}
              </span>
              {formatAttrPrice(attr, freeOffer)}
            </div>
          );
        }

        // REQ-05-007: Badge/Sponsor Logo
        if (isBadgeOrSponsor) {
          return (
            <div key={attr.id}>
              <span className="text-muted-foreground">{attr.optionName}: </span>
              <span
                className="cursor-pointer text-blue-600 underline"
                title="Click to view badge/sponsor details (SPEC-06)"
              >
                {attr.optionValue}
              </span>
              {formatAttrPrice(attr, freeOffer)}
            </div>
          );
        }

        // Other size-type attributes (stripos match)
        if (attr.optionName.toLowerCase().includes('size')) {
          return (
            <div key={attr.id}>
              <span className="text-muted-foreground">{attr.optionName}: </span>
              <span className="uppercase">{attr.optionValue}</span>
              <span
                className="ml-1 cursor-pointer text-[10px] text-green-600 underline"
                title="Change Product Size (SPEC-06)"
              >
                Change Product Size
              </span>
              {formatAttrPrice(attr, freeOffer)}
            </div>
          );
        }

        // Other non-empty attributes
        if (attr.optionValue) {
          return (
            <div key={attr.id}>
              <span className="text-muted-foreground">- {attr.optionName}: </span>
              <span className="uppercase">{attr.optionValue}</span>
              {formatAttrPrice(attr, freeOffer)}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

/** Format attribute price suffix */
function formatAttrPrice(attr: ProductAttribute, freeOffer: boolean): React.ReactNode {
  if (attr.price == null || attr.price === 0) {
    if (attr.isFree && freeOffer) {
      return <span className="ml-1 text-green-600">(FREE)</span>;
    }
    return null;
  }

  const prefix = attr.pricePrefix === '-' ? '-' : '+';
  return (
    <span className="ml-1 text-muted-foreground">
      ({prefix}£{attr.price.toFixed(2)})
    </span>
  );
}
