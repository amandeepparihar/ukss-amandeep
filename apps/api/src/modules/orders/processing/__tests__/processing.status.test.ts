/**
 * Unit tests for determineProposedStatus() — N4 status precedence.
 *
 * Faithful to legacy order_processing_new.php:1539-1550, where the per-product
 * loop computes a base status (retro 22 / printing 14·24 / picking 16) and then
 * an override block forces:
 *   - status 12 (Pre Order)  if ANY product line is a pre-order (preOrderedOrderBit)
 *   - status 2  (Processing) else if ANY product line is out of stock
 * So final precedence is: preOrder(12) > OOS(2) > retro(22) > printing(14/24) > picking(16).
 */
import { describe, it, expect } from 'vitest';
import { determineProposedStatus } from '../processing.status';
import { STATUS } from '../../orders.constants';

describe('determineProposedStatus — N4 override precedence', () => {
  it('pre-order wins over everything (retro + OOS + printing)', () => {
    const r = determineProposedStatus(
      /*hasRetro*/ true,
      /*hasPrinting*/ true,
      /*hasPreOrder*/ true,
      /*hasOutOfStock*/ true,
    );
    expect(r.status).toBe(STATUS.PRE_ORDERED); // 12
  });

  it('out-of-stock wins over retro/printing/picking when not pre-order', () => {
    const r = determineProposedStatus(true, true, false, true);
    expect(r.status).toBe(STATUS.PROCESSING); // 2
  });

  it('retro (toffs/copa) when no pre-order and no OOS', () => {
    const r = determineProposedStatus(true, false, false, false);
    expect(r.status).toBe(STATUS.RETRO_SHIRTS); // 22
  });

  it('printing → Awaiting Printing when no retro/pre-order/OOS', () => {
    const r = determineProposedStatus(false, true, false, false);
    expect(r.status).toBe(STATUS.AWAITING_PRINTING); // 14
  });

  it('plain pickable → Being Picked', () => {
    const r = determineProposedStatus(false, false, false, false);
    expect(r.status).toBe(STATUS.BEING_PICKED); // 16
  });

  it('retro does NOT override pre-order (regression guard for old retro-first behaviour)', () => {
    const r = determineProposedStatus(true, false, true, false);
    expect(r.status).toBe(STATUS.PRE_ORDERED); // 12, not 22
  });
});
