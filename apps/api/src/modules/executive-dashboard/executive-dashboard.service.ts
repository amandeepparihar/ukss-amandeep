/**
 * Executive Dashboard Service — thin wrapper.
 *
 * No query logic is duplicated here: all 3 functions delegate directly to
 * the existing sales-dashboard module's already-cached implementations.
 */

import type { TrendResponse, MarketplacePerformance, KPIData } from '@admin/shared';
import { getTrends, getMarketplaceBreakdown, daysBetween } from '../sales-dashboard/sales-dashboard.service';
import { getKPIStats } from '../sales-dashboard/kpi.helper';

const MAX_WEEKLY_RANGE_DAYS = 90;

export async function getExecutiveTrends(
  startDate: string,
  endDate: string,
  stores?: number[],
  comparePrevious?: boolean,
  noCache?: boolean,
): Promise<TrendResponse> {
  const rangeDays = daysBetween(startDate, endDate);
  const granularityOverride: 'weekly' | 'monthly' = rangeDays > MAX_WEEKLY_RANGE_DAYS ? 'monthly' : 'weekly';
  return getTrends(startDate, endDate, stores, comparePrevious, granularityOverride, noCache);
}

export async function getExecutiveKPIs(
  startDate: string,
  endDate: string,
  stores?: number[],
  noCache?: boolean,
): Promise<KPIData> {
  // 'year' is a placeholder — getKPIStats's cache key is driven by the
  // customRange dates, not this value, once a customRange is supplied.
  return getKPIStats('year', stores, { startDate, endDate }, noCache);
}

export async function getExecutiveMarketplaceBreakdown(
  startDate: string,
  endDate: string,
  noCache?: boolean,
): Promise<MarketplacePerformance[]> {
  return getMarketplaceBreakdown(startDate, endDate, 50, noCache);
}
