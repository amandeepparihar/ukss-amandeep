/**
 * Regression test for the eBay terminal error-code map (correction #2):
 * 21920397 (policy/IP violation) and 231 (item not found) must map to 'deleted'
 * so those listings drop out of the sync set instead of lingering.
 */

import { describe, it, expect, vi } from 'vitest';

// adapter.ts loads config/logger/db/client at module scope; mock them so importing
// the pure terminalListingStatus helper has no side effects.
vi.mock('../../../config', () => ({
  config: { EBAY_REDUNDANT_REVISION_ERROR_CODES: ['21917091', '21917092', '21917093'] },
}));
vi.mock('../../../modules/marketplace-sync/marketplace-sync.db', () => ({}));
vi.mock('./client', () => ({ createEbayClient: vi.fn() }));
vi.mock('../../logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { buildFailedItemsMap, terminalListingStatus } from './adapter';

describe('terminalListingStatus (correction #2)', () => {
  it('maps 21920397 (policy/IP violation) to deleted', () => {
    expect(terminalListingStatus('21920397')).toBe('deleted');
  });

  it('maps 231 (item not found) to deleted', () => {
    expect(terminalListingStatus('231')).toBe('deleted');
  });

  it('keeps 21916750 (ended) as deleted in the sync path — relisting is a separate job', () => {
    expect(terminalListingStatus('21916750')).toBe('deleted');
  });

  it('returns null for non-terminal / unknown codes', () => {
    expect(terminalListingStatus('21917091')).toBeNull();
    expect(terminalListingStatus('00000')).toBeNull();
  });
});

describe('buildFailedItemsMap', () => {
  it('keeps SKU-specific errors when multiple variations share one ItemID', () => {
    const failedItems = buildFailedItemsMap([
      {
        itemId: '157198081959',
        sku: 'p-178267-2641',
        errorCode: '21916750',
        errorMessage: 'FixedPrice item ended.',
        severityCode: 'Error',
      },
      {
        itemId: '157198081959',
        sku: 'p-178267-2645',
        errorCode: '21917093',
        errorMessage: 'Requested StartPrice revision is redundant.',
        severityCode: 'Warning',
      },
    ]);

    expect(failedItems.get('p-178267-2641')?.errorCode).toBe('21916750');
    expect(failedItems.get('p-178267-2645')?.errorCode).toBe('21917093');
  });
});
