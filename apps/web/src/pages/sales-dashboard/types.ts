// Sales Dashboard V2 — shared TypeScript interfaces

// ─── Events ──────────────────────────────────────────────────────────

export interface SalesEvent {
  eventId: number;
  eventName: string;
  eventCategory: string;
  eventType: string;
  region: string;
  buyingWindowStart: string;
  buyingWindowEnd: string;
  eventStartDate: string;
  eventEndDate: string;
  year: number;
  notes: string | null;
}

// ─── Filters / Params ────────────────────────────────────────────────

export interface DateRangeParams {
  startDate: string;
  endDate: string;
}

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface ChartProps {
  startDate: string;
  endDate: string;
  events?: SalesEvent[];
}

// ─── Team Sales (Req 2) ─────────────────────────────────────────────

export interface TeamSalesSummary {
  teamId: number;
  teamName: string;
  totalUnitsSold: number;
  totalRevenue: number;
}

export interface TeamSalesTimeSeriesEntry {
  period: string;
  teams: Array<{
    teamId: number;
    teamName: string;
    unitsSold: number;
    revenue: number;
  }>;
}

export interface TeamSalesResponse {
  summary: TeamSalesSummary[];
  timeSeries: TeamSalesTimeSeriesEntry[];
}

// ─── Product Type Sales (Req 3) ──────────────────────────────────────

export interface ProductTypeSalesSummary {
  typeId: number;
  typeName: string;
  totalOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  percentageOfTotal: number;
}

export interface ProductTypeSalesTimeSeriesEntry {
  period: string;
  types: Array<{
    typeId: number;
    typeName: string;
    unitsSold: number;
    revenue: number;
  }>;
}

export interface ProductTypeSalesResponse {
  summary: ProductTypeSalesSummary[];
  timeSeries: ProductTypeSalesTimeSeriesEntry[];
}

// ─── Gender Sales (Req 4) ────────────────────────────────────────────

export interface GenderSalesSummary {
  gender: string;
  totalOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  percentageOfTotal: number;
}

export interface GenderSalesTimeSeriesEntry {
  period: string;
  genders: Array<{
    gender: string;
    unitsSold: number;
    revenue: number;
  }>;
}

export interface GenderSalesResponse {
  summary: GenderSalesSummary[];
  timeSeries: GenderSalesTimeSeriesEntry[];
}

// ─── Personalisation (Req 5) ─────────────────────────────────────────

export interface PersonalisationSegment {
  totalOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  averageOrderValue: number;
  percentageOfTotal: number;
}

export interface PersonalisationSummary {
  personalised: PersonalisationSegment;
  nonPersonalised: PersonalisationSegment;
}

export interface PersonalisationTimeSeriesEntry {
  period: string;
  personalised: { unitsSold: number; revenue: number };
  nonPersonalised: { unitsSold: number; revenue: number };
}

export interface PersonalisationResponse {
  summary: PersonalisationSummary;
  personalisationPremium: number;
  timeSeries: PersonalisationTimeSeriesEntry[];
}

// ─── Order Health (Req 6) ────────────────────────────────────────────

export interface OrderHealthSummary {
  totalProductsOrdered: number;
  totalUnits: number;
  totalRevenue: number;
  productsRejected: {
    count: number;
    units: number;
    revenue: number;
    rate: number;
  };
  ordersRejected: {
    count: number;
    rate: number;
  };
  productsReturned: {
    count: number;
    units: number;
    revenue: number;
    rate: number;
  };
  fulfillmentRate: number;
}

export interface OrderHealthTimeSeriesEntry {
  period: string;
  totalProducts: number;
  totalUnits: number;
  totalRevenue: number;
  rejected: { products: number; units: number; revenue: number };
  returned: { products: number; units: number; revenue: number };
  rejectionRate: number;
  returnRate: number;
  fulfillmentRate: number;
}

export interface OrderHealthResponse {
  summary: OrderHealthSummary;
  timeSeries: OrderHealthTimeSeriesEntry[];
}

// ─── Daily Revenue Heatmap (V2 Req 1) ──────────────────────────────

export interface DailyRevenueEntry {
  date: string;
  revenue: number;
}

export interface DailyRevenueResponse {
  current: DailyRevenueEntry[];
  priorYear?: DailyRevenueEntry[];
}

// ─── Revenue by Day/Hour (V2 Req 2) ────────────────────────────────

export interface DayRevenueEntry {
  dayOfWeek: number;
  dayName: string;
  avgRevenue: number;
  totalRevenue: number;
  orderCount: number;
}

export interface HourRevenueEntry {
  hour: number;
  avgRevenue: number;
  totalRevenue: number;
  orderCount: number;
}

export interface RevenueDayHourResponse {
  byDay: DayRevenueEntry[];
  byHour: HourRevenueEntry[];
}

// ─── Customer Segments (V2 Req 3) ──────────────────────────────────

export interface CustomerSegmentTimeSeries {
  period: string;
  newRevenue: number;
  repeatRevenue: number;
  newOrders: number;
  repeatOrders: number;
  repeatPercentage: number;
}

export interface CustomerSegmentsSummary {
  totalNewRevenue: number;
  totalRepeatRevenue: number;
  totalNewOrders: number;
  totalRepeatOrders: number;
  overallRepeatPercentage: number;
}

export interface CustomerSegmentsResponse {
  summary: CustomerSegmentsSummary;
  timeSeries: CustomerSegmentTimeSeries[];
}

// ─── Return Rate (V2 Req 4) ────────────────────────────────────────

export interface ReturnReasonBreakdown {
  reason: string;
  count: number;
  percentage: number;
}

export interface ReturnRateByType {
  typeId: number;
  typeName: string;
  totalProducts: number;
  returnedProducts: number;
  returnRate: number;
  exceedsThreshold: boolean;
  reasons: ReturnReasonBreakdown[];
}

export interface ReturnRateTrend {
  period: string;
  returnRate: number;
  totalProducts: number;
  returnedProducts: number;
}

export interface ReturnRateResponse {
  byType: ReturnRateByType[];
  trend: ReturnRateTrend[];
  alertThreshold: number;
}

// ─── Inventory Quadrant (V2 Req 5) ─────────────────────────────────

export interface InventoryQuadrantProduct {
  productId: number;
  productName: string;
  currentStock: number;
  dailySalesRate: number;
  turnoverRate: number;
  daysOfStock: number;
  quadrant: 'fast-movers-risk' | 'healthy' | 'slow-stable' | 'dead-stock';
}

export interface QuadrantSummary {
  fastMoversRisk: number;
  healthy: number;
  slowStable: number;
  deadStock: number;
}

export interface InventoryQuadrantResponse {
  products: InventoryQuadrantProduct[];
  summary: QuadrantSummary;
  thresholds: { turnover: number; stockDays: number };
}

// ─── Geographic Revenue (V2 Req 6) ─────────────────────────────────

export interface GeoRegionData {
  region: string;
  lat: number;
  lng: number;
  totalRevenue: number;
  orderCount: number;
  avgDeliveryDays: number | null;
  returnRate: number;
}

export interface GeoRevenueResponse {
  regions: GeoRegionData[];
  topRegions: GeoRegionData[];
  bottomRegions: GeoRegionData[];
}
