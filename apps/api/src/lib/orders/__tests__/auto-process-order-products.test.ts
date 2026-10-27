/**
 * Unit tests for autoProcessOrderProducts()
 *
 * Tests the warehouse queue insertion logic with mocked database calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @prisma/client to provide Prisma.sql tagged template
vi.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: vi.fn(),
  },
}));

// Mock prisma before importing the module under test
vi.mock('../../prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

// Mock the stock functions from processing.stock
vi.mock('../../../modules/orders/processing/processing.stock', () => ({
  resolveSmsSize: vi.fn(),
  resolveProductCode: vi.fn(),
  checkSmsStock: vi.fn(),
  checkParentStock: vi.fn(),
  isTshirtCategory2214: vi.fn(),
}));

// Mock logger
vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import { autoProcessOrderProducts, isToffsLine } from '../auto-process-order-products';
import { prisma } from '../../prisma';
import {
  resolveSmsSize,
  resolveProductCode,
  checkSmsStock,
  checkParentStock,
  isTshirtCategory2214,
} from '../../../modules/orders/processing/processing.stock';

const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>;
const mockExecuteRaw = prisma.$executeRaw as ReturnType<typeof vi.fn>;
const mockResolveSmsSize = resolveSmsSize as ReturnType<typeof vi.fn>;
const mockResolveProductCode = resolveProductCode as ReturnType<typeof vi.fn>;
const mockCheckSmsStock = checkSmsStock as ReturnType<typeof vi.fn>;
const mockCheckParentStock = checkParentStock as ReturnType<typeof vi.fn>;
const mockIsTshirtCategory2214 = isTshirtCategory2214 as ReturnType<typeof vi.fn>;

describe('autoProcessOrderProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no overrides apply unless a test opts in.
    mockIsTshirtCategory2214.mockResolvedValue(false);
    mockCheckParentStock.mockResolvedValue(null);
  });

  it('should skip if no orderId provided', async () => {
    await autoProcessOrderProducts(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('should skip if no order products found', async () => {
    // First call: order products query → empty
    mockQueryRaw
      .mockResolvedValueOnce([]) // order products
    ;

    await autoProcessOrderProducts(100);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('should skip if pre_processed rows already exist', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ orders_products_id: 1, products_id: 10, products_model: 'ABC', products_price: 50, products_quantity: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }]) // existing rows
    ;

    await autoProcessOrderProducts(100);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('should insert pre_processed rows when all products in stock', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'ABC-123', products_price: 50, products_quantity: 1 },
      { orders_products_id: 2, products_id: 20, products_model: 'DEF-456', products_price: 30, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)       // order products
      .mockResolvedValueOnce([{ cnt: 0 }])         // no existing pre_processed rows
    ;

    mockResolveSmsSize
      .mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' })
      .mockResolvedValueOnce({ sizeId: 7, sizeName: 'L' });

    mockResolveProductCode
      .mockResolvedValueOnce({ productListsId: 100, parentProductListsId: 0 })
      .mockResolvedValueOnce({ productListsId: 200, parentProductListsId: 0 });

    mockCheckSmsStock
      .mockResolvedValueOnce({ available: true, quantity: 10, boxCode: 'A1', barcode: '123', productListsId: 100, boxListsId: 1 })
      .mockResolvedValueOnce({ available: true, quantity: 5, boxCode: 'B2', barcode: '456', productListsId: 200, boxListsId: 2 });

    mockExecuteRaw.mockResolvedValue(1);

    await autoProcessOrderProducts(100);

    // Should insert 2 rows (one per product)
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });

  it('should NOT insert when any product is out of stock', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'ABC-123', products_price: 50, products_quantity: 1 },
      { orders_products_id: 2, products_id: 20, products_model: 'DEF-456', products_price: 30, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }])
    ;

    mockResolveSmsSize
      .mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' })
      .mockResolvedValueOnce({ sizeId: 7, sizeName: 'L' });

    mockResolveProductCode
      .mockResolvedValueOnce({ productListsId: 100, parentProductListsId: 0 })
      .mockResolvedValueOnce({ productListsId: 200, parentProductListsId: 0 });

    mockCheckSmsStock
      .mockResolvedValueOnce({ available: true, quantity: 10, boxCode: 'A1', barcode: '123', productListsId: 100, boxListsId: 1 })
      .mockResolvedValueOnce({ available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 200, boxListsId: 0 }); // OUT OF STOCK

    await autoProcessOrderProducts(100);

    // Should NOT insert any rows
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('should NOT insert when size resolution fails', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'ABC-123', products_price: 50, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }])
    ;

    mockResolveSmsSize.mockResolvedValueOnce(null); // size not found

    await autoProcessOrderProducts(100);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('should NOT insert when product code resolution fails', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'ABC-123', products_price: 50, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }])
    ;

    mockResolveSmsSize.mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' });
    mockResolveProductCode.mockResolvedValueOnce(null); // product code not found

    await autoProcessOrderProducts(100);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // PHP parity: hero-shirt parent fallback (pre_processed_order.php:289-324)
  // ---------------------------------------------------------------------------

  it('should insert when child has no stock but hero-shirt parent does', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'HERO-001', products_price: 50, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);

    mockResolveSmsSize.mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' });
    mockResolveProductCode.mockResolvedValueOnce({ productListsId: 100, parentProductListsId: 99 });

    mockCheckSmsStock.mockResolvedValueOnce({
      available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 100, boxListsId: 0,
    });
    mockCheckParentStock.mockResolvedValueOnce({
      available: true, quantity: 8, boxCode: 'P1', barcode: '999', productListsId: 99, boxListsId: 7,
    });

    mockExecuteRaw.mockResolvedValue(1);

    await autoProcessOrderProducts(100);

    expect(mockCheckParentStock).toHaveBeenCalledWith(99, 5, 1, null);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('should NOT insert when both child and hero-shirt parent are out of stock', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'HERO-002', products_price: 50, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);

    mockResolveSmsSize.mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' });
    mockResolveProductCode.mockResolvedValueOnce({ productListsId: 100, parentProductListsId: 99 });

    mockCheckSmsStock.mockResolvedValueOnce({
      available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 100, boxListsId: 0,
    });
    mockCheckParentStock.mockResolvedValueOnce(null); // parent also empty

    await autoProcessOrderProducts(100);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // PHP parity: T-shirt category #2214# override (pre_processed_order.php:326-335)
  // ---------------------------------------------------------------------------

  it('should insert when out-of-stock product is in T-shirt category #2214#', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 135353, products_model: 'TSHIRT-Red-135353', products_price: 25, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);

    mockResolveSmsSize.mockResolvedValueOnce({ sizeId: 12, sizeName: 'XXL' });
    mockResolveProductCode.mockResolvedValueOnce({ productListsId: 85048, parentProductListsId: 0 });

    mockCheckSmsStock.mockResolvedValueOnce({
      available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 85048, boxListsId: 0,
    });
    mockIsTshirtCategory2214.mockResolvedValueOnce(true);

    mockExecuteRaw.mockResolvedValue(1);

    await autoProcessOrderProducts(100);

    // Parent fallback should NOT have been invoked (parentProductListsId=0)
    expect(mockCheckParentStock).not.toHaveBeenCalled();
    expect(mockIsTshirtCategory2214).toHaveBeenCalledWith(135353);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('should NOT insert when one line passes via override but another fails everything', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 135353, products_model: 'TSHIRT-A', products_price: 25, products_quantity: 1 },
      { orders_products_id: 2, products_id: 200, products_model: 'OTHER-B', products_price: 30, products_quantity: 1 },
    ];

    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);

    mockResolveSmsSize
      .mockResolvedValueOnce({ sizeId: 12, sizeName: 'XXL' })
      .mockResolvedValueOnce({ sizeId: 5, sizeName: 'M' });

    mockResolveProductCode
      .mockResolvedValueOnce({ productListsId: 85048, parentProductListsId: 0 })
      .mockResolvedValueOnce({ productListsId: 200, parentProductListsId: 0 });

    mockCheckSmsStock
      .mockResolvedValueOnce({ available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 85048, boxListsId: 0 })
      .mockResolvedValueOnce({ available: false, quantity: 0, boxCode: '', barcode: '', productListsId: 200, boxListsId: 0 });

    // Line A passes via category-2214 override; line B does not.
    mockIsTshirtCategory2214
      .mockResolvedValueOnce(true)   // line A
      .mockResolvedValueOnce(false); // line B

    await autoProcessOrderProducts(100);

    // All-or-nothing rule is preserved: line B failed, so no inserts at all.
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('should force-queue an out-of-stock TOFFS product (toffs column) without a stock check', async () => {
    // toffs are supplier-sourced (PMS #165061): force-enqueue regardless of SMS stock so the
    // order-processing cron routes them to status 2 -> supplier. No size/stock mocks needed —
    // the toffs override short-circuits before resolveSmsSize/checkSmsStock.
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'TOFFS-RETRO-1', products_price: 50, products_quantity: 1, toffs: '1', manufacturers_id: 35, order_site: 81 },
    ];
    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);
    mockExecuteRaw.mockResolvedValue(1);

    await autoProcessOrderProducts(100);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockResolveSmsSize).not.toHaveBeenCalled(); // short-circuited
  });

  it('should force-queue an out-of-stock product from a TOFFS store with a TOFFS manufacturer', async () => {
    const orderProducts = [
      { orders_products_id: 1, products_id: 10, products_model: 'X', products_price: 50, products_quantity: 1, toffs: '', manufacturers_id: 35, order_site: 143 },
    ];
    mockQueryRaw
      .mockResolvedValueOnce(orderProducts)
      .mockResolvedValueOnce([{ cnt: 0 }]);
    mockExecuteRaw.mockResolvedValue(1);

    await autoProcessOrderProducts(100);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });
});

describe('isToffsLine', () => {
  it('true when toffs column is non-empty (incl. "0", matching legacy != "")', () => {
    expect(isToffsLine({ toffs: '1', manufacturers_id: null, order_site: 81 })).toBe(true);
    expect(isToffsLine({ toffs: '0', manufacturers_id: null, order_site: 81 })).toBe(true);
  });

  it('true when toffs store (143/146) + toffs manufacturer (35/107)', () => {
    expect(isToffsLine({ toffs: '', manufacturers_id: 35, order_site: 143 })).toBe(true);
    expect(isToffsLine({ toffs: '', manufacturers_id: 107, order_site: 146 })).toBe(true);
  });

  it('false when manufacturer not in mapping, even on a toffs store', () => {
    expect(isToffsLine({ toffs: '', manufacturers_id: 99, order_site: 143 })).toBe(false);
  });

  it('false when toffs manufacturer but not a toffs store', () => {
    expect(isToffsLine({ toffs: '', manufacturers_id: 35, order_site: 81 })).toBe(false);
  });

  it('false for a plain product (no toffs signal)', () => {
    expect(isToffsLine({ toffs: '', manufacturers_id: null, order_site: null })).toBe(false);
    expect(isToffsLine({ toffs: null, manufacturers_id: null, order_site: null })).toBe(false);
  });
});
