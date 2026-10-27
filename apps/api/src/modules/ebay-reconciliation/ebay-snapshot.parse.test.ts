import { describe, it, expect } from 'vitest';
import { parseActiveListingItem } from './ebay-snapshot.parse';

describe('parseActiveListingItem', () => {
  it('returns one row per variation with qtyAvailable = Quantity - QuantitySold floored at 0', () => {
    const rows = parseActiveListingItem({
      ItemID: '157464453533',
      Title: 'Retro Shirt',
      Variations: {
        Variation: [
          { SKU: 'SH-M', Quantity: 1, SellingStatus: { QuantitySold: 0 }, StartPrice: { value: 24.99, currencyID: 'GBP' } },
          { SKU: 'SH-L', Quantity: 1, SellingStatus: { QuantitySold: 2 }, StartPrice: { value: 24.99, currencyID: 'GBP' } },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemId: '157464453533', sku: 'SH-M', isVariation: true, price: 24.99, currency: 'GBP', qtyAvailable: 1 });
    expect(rows[1].qtyAvailable).toBe(0); // 1 - 2 floored
  });

  it('handles a single Variation object (eBay XML->JSON collapses one-element arrays)', () => {
    const rows = parseActiveListingItem({
      ItemID: '111', Title: 'T',
      Variations: { Variation: { SKU: 'ONLY', Quantity: 3, SellingStatus: { QuantitySold: 1 }, StartPrice: 9.5 } },
    });
    expect(rows).toEqual([expect.objectContaining({ sku: 'ONLY', qtyAvailable: 2, price: 9.5 })]);
  });

  it('returns one item-level row for non-variation listings, sku null when no seller SKU', () => {
    const rows = parseActiveListingItem({
      ItemID: '222', Title: 'Plain', Quantity: 5,
      SellingStatus: { QuantitySold: 1, CurrentPrice: { value: '12.50', currencyID: 'GBP' } },
    });
    expect(rows).toEqual([
      expect.objectContaining({ itemId: '222', sku: null, isVariation: false, qtyListed: 5, qtySold: 1, qtyAvailable: 4, price: 12.5, currency: 'GBP' }),
    ]);
  });

  it('uses the item SKU when present and tolerates missing price/quantity fields', () => {
    const rows = parseActiveListingItem({ ItemID: '333', Title: 'Bare', SKU: 'BARE-1' });
    expect(rows).toEqual([
      expect.objectContaining({ sku: 'BARE-1', price: null, currency: null, qtyListed: 0, qtySold: 0, qtyAvailable: 0 }),
    ]);
  });

  it('returns [] for an item with no ItemID and truncates 300-char titles to 255', () => {
    expect(parseActiveListingItem({ Title: 'no id' })).toEqual([]);
    const rows = parseActiveListingItem({ ItemID: '444', Title: 'x'.repeat(300) });
    expect(rows[0].title).toHaveLength(255);
  });
});
