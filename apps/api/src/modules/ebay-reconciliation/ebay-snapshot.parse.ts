/**
 * Pure parsing of GetMyeBaySelling ActiveList items into snapshot rows.
 * Defensive: the ebay-api SDK's XML->JSON gives single objects for one-element
 * arrays and money as either a scalar or { value, currencyID }.
 */
import type { ClassifierSnapshotRow } from './ebay-classifier';

const toArr = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

const toInt = (v: unknown): number => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const money = (p: unknown): number | null => {
  if (p === undefined || p === null) return null;
  const raw = typeof p === 'object' ? (p as any).value ?? (p as any)['#text'] : p;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const currencyOf = (p: unknown): string | null => {
  if (p === null || typeof p !== 'object') return null;
  const c = (p as any).currencyID ?? (p as any)['@_currencyID'];
  return c ? String(c).slice(0, 3) : null;
};

const strOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : null;
};

export function parseActiveListingItem(item: unknown): ClassifierSnapshotRow[] {
  const it = item as any;
  const itemId = String(it?.ItemID ?? '').trim();
  if (!itemId) return [];
  const title = String(it?.Title ?? '').slice(0, 255);

  const variations = toArr(it?.Variations?.Variation);
  if (variations.length > 0) {
    return variations.map((v: any) => {
      const qtyListed = toInt(v?.Quantity);
      const qtySold = toInt(v?.SellingStatus?.QuantitySold);
      const price = v?.StartPrice;
      return {
        itemId,
        sku: strOrNull(v?.SKU),
        title,
        isVariation: true,
        price: money(price),
        currency: currencyOf(price),
        qtyListed,
        qtySold,
        qtyAvailable: Math.max(0, qtyListed - qtySold),
      };
    });
  }

  const qtyListed = toInt(it?.Quantity);
  const qtySold = toInt(it?.SellingStatus?.QuantitySold);
  const price = it?.SellingStatus?.CurrentPrice ?? it?.StartPrice ?? it?.BuyItNowPrice ?? null;
  return [
    {
      itemId,
      sku: strOrNull(it?.SKU),
      title,
      isVariation: false,
      price: money(price),
      currency: currencyOf(price),
      qtyListed,
      qtySold,
      qtyAvailable: Math.max(0, qtyListed - qtySold),
    },
  ];
}
