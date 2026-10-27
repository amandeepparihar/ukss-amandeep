/**
 * Unit tests for calculateShipByDate() — the pure date calculation function.
 *
 * Tests all day/time/printing combinations from the PHP assign_ship_date.php logic.
 * No database access — tests the pure function only.
 *
 * Uses LondonTime struct directly — no Date objects, no timezone dependency.
 * Tests will produce the same results regardless of the server's timezone.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock prisma and logger to avoid Prisma client initialization
vi.mock('../../prisma', () => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../modules/orders/processing/processing.stock', () => ({
  detectPrintingOptions: vi.fn(),
}));

import { calculateShipByDate, PRINTING_FLAG, type LondonTime } from '../assign-ship-date';

/** Helper: create a LondonTime for a specific day and time */
function london(day: string, time: string, date: string): LondonTime {
  return { day, time, date };
}

/** Helper: extract just the date part from result */
function dateOf(result: string | null): string | null {
  if (!result) return null;
  return result.split(' ')[0];
}

describe('calculateShipByDate', () => {
  const MAX_PRINTING_DAYS = 3;

  describe('printingFlag = 2 (zero stock)', () => {
    it('should return null', () => {
      const lt = london('Wed', '10:00:00', '2026-03-25');
      expect(calculateShipByDate(PRINTING_FLAG.ZERO_STOCK, lt, MAX_PRINTING_DAYS)).toBeNull();
    });
  });

  describe('standard orders (printingFlag = 0)', () => {
    // Monday cutoff: 11:00 AM
    it('Mon before 11AM → today', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Mon', '09:00:00', '2026-03-23'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-23');
      expect(result).toContain('23:59:59');
    });

    it('Mon at exactly 11AM → today (<=)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Mon', '11:00:00', '2026-03-23'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-23');
    });

    it('Mon after 11AM → tomorrow (Tue)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Mon', '12:00:00', '2026-03-23'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-24');
    });

    // Tue-Thu cutoff: 2:00 PM
    it('Tue before 2PM → today', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Tue', '13:00:00', '2026-03-24'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-24');
    });

    it('Tue at exactly 2PM → today (<=)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Tue', '14:00:00', '2026-03-24'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-24');
    });

    it('Tue after 2PM → tomorrow (Wed)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Tue', '15:00:00', '2026-03-24'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-25');
    });

    it('Wed before 2PM → today', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Wed', '10:00:00', '2026-03-25'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-25');
    });

    it('Wed after 2PM → tomorrow (Thu)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Wed', '16:00:00', '2026-03-25'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-26');
    });

    it('Thu before 2PM → today', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Thu', '13:00:00', '2026-03-26'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-26');
    });

    it('Thu after 2PM → tomorrow (Fri)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Thu', '15:00:00', '2026-03-26'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-27');
    });

    // Friday
    it('Fri before 2PM → today', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Fri', '10:00:00', '2026-03-27'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-27');
    });

    it('Fri after 2PM → Monday (+3 days)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Fri', '16:00:00', '2026-03-27'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    // Weekend
    it('Sat before 2PM → Monday (+2 days)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Sat', '10:00:00', '2026-03-28'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    it('Sat after 2PM → Monday (+2 days)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Sat', '16:00:00', '2026-03-28'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    it('Sun → Monday (+1 day)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Sun', '10:00:00', '2026-03-29'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    it('all results end with 23:59:59', () => {
      const cases = [
        london('Mon', '09:00:00', '2026-03-23'),
        london('Tue', '10:00:00', '2026-03-24'),
        london('Fri', '16:00:00', '2026-03-27'),
        london('Sat', '12:00:00', '2026-03-28'),
      ];
      for (const lt of cases) {
        const result = calculateShipByDate(PRINTING_FLAG.STANDARD, lt, MAX_PRINTING_DAYS);
        expect(result).toContain('23:59:59');
      }
    });
  });

  describe('printing orders (printingFlag = 1) with MAX_PRINTING_DAYS = 3', () => {
    // Monday cutoff: 11:00 AM
    it('Mon before 11AM → +3 days (Thu)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Mon', '09:00:00', '2026-03-23'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-26');
    });

    it('Mon after 11AM → +4 days (Fri)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Mon', '12:00:00', '2026-03-23'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-27');
    });

    // Tuesday special case (printing_days=3)
    it('Tue before 2PM, days=3 → +3 days (Fri)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Tue', '10:00:00', '2026-03-24'), 3);
      expect(dateOf(result)).toBe('2026-03-27');
    });

    it('Tue before 2PM, days=5 → +7 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Tue', '10:00:00', '2026-03-24'), 5);
      expect(dateOf(result)).toBe('2026-03-31');
    });

    it('Tue after 2PM, days=3 → +6 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Tue', '15:00:00', '2026-03-24'), 3);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    it('Tue after 2PM, days=5 → +7 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Tue', '15:00:00', '2026-03-24'), 5);
      expect(dateOf(result)).toBe('2026-03-31');
    });

    // Wed-Fri before 2PM: +printing_days+2
    it('Wed before 2PM → +5 days (Mon)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Wed', '10:00:00', '2026-03-25'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-30');
    });

    it('Thu before 2PM → +5 days (Tue)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Thu', '10:00:00', '2026-03-26'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-31');
    });

    // Wed-Fri after 2PM: +printing_days+3
    it('Wed after 2PM → +6 days (Tue)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Wed', '16:00:00', '2026-03-25'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-03-31');
    });

    it('Fri after 2PM → +6 days (Thu)', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Fri', '16:00:00', '2026-03-27'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-04-02');
    });

    // Weekend
    it('Sat → +5 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Sat', '10:00:00', '2026-03-28'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-04-02');
    });

    it('Sun → +4 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Sun', '10:00:00', '2026-03-29'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-04-02');
    });

    it('all results end with 23:59:59', () => {
      const cases = [
        london('Mon', '09:00:00', '2026-03-23'),
        london('Wed', '10:00:00', '2026-03-25'),
        london('Sat', '12:00:00', '2026-03-28'),
      ];
      for (const lt of cases) {
        const result = calculateShipByDate(PRINTING_FLAG.PRINTING, lt, MAX_PRINTING_DAYS);
        expect(result).toContain('23:59:59');
      }
    });
  });

  describe('edge cases', () => {
    it('MAX_PRINTING_DAYS = 1 on Wed before 2PM → +3 days', () => {
      const result = calculateShipByDate(PRINTING_FLAG.PRINTING, london('Wed', '10:00:00', '2026-03-25'), 1);
      expect(dateOf(result)).toBe('2026-03-28');
    });

    it('month boundary: Jan 30 + 3 days → Feb 2', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Fri', '16:00:00', '2026-01-30'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-02-02');
    });

    it('year boundary: Dec 31 + 1 day → Jan 1', () => {
      const result = calculateShipByDate(PRINTING_FLAG.STANDARD, london('Wed', '16:00:00', '2025-12-31'), MAX_PRINTING_DAYS);
      expect(dateOf(result)).toBe('2026-01-01');
    });
  });
});
