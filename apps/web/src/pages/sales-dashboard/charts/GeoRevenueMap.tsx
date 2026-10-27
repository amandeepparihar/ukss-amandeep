import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { formatCurrency, formatPercent } from '../lib/chart-utils';
import type { GeoRevenueResponse, GeoRegionData, ChartProps } from '../types';

function getColor(revenue: number, maxRevenue: number): string {
  const ratio = Math.min(revenue / (maxRevenue || 1), 1);
  // Green scale: lighter for low, darker for high
  const r = Math.round(255 - ratio * 200);
  const g = Math.round(255 - ratio * 60);
  const b = Math.round(255 - ratio * 200);
  return `rgb(${r}, ${g}, ${b})`;
}

function getRadius(revenue: number, maxRevenue: number): number {
  const ratio = Math.min(revenue / (maxRevenue || 1), 1);
  return 6 + ratio * 24;
}

export default function GeoRevenueMap({ startDate, endDate }: ChartProps) {
  const [selectedRegion, setSelectedRegion] = useState<GeoRegionData | null>(null);
  const { data, isLoading, isError, refetch } = useChartData<GeoRevenueResponse>({
    endpoint: 'geo-revenue',
    params: { startDate, endDate },
  });

  const maxRevenue = useMemo(() => {
    if (!data?.regions?.length) return 1;
    return Math.max(...data.regions.map((r) => r.totalRevenue));
  }, [data]);

  const mapRegions = useMemo(() => {
    return (data?.regions ?? []).filter((r) => r.lat !== 0 && r.lng !== 0);
  }, [data]);

  return (
    <ChartCard
      title="Geographic Revenue Map"
      description="Revenue distribution by region"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.regions?.length}
      onRetry={() => refetch()}
      className="lg:col-span-2"
    >
      <div className="flex gap-4">
        <div className="flex-1" style={{ height: 400 }}>
          {mapRegions.length > 0 && (
            <MapContainer
              center={[54.0, -2.0]}
              zoom={6}
              style={{ height: '100%', width: '100%', borderRadius: 8 }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {mapRegions.map((region) => (
                <CircleMarker
                  key={region.region}
                  center={[region.lat, region.lng]}
                  radius={getRadius(region.totalRevenue, maxRevenue)}
                  fillColor={getColor(region.totalRevenue, maxRevenue)}
                  fillOpacity={0.7}
                  color="#fff"
                  weight={1}
                  eventHandlers={{ click: () => setSelectedRegion(region) }}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-bold">{region.region}</p>
                      <p>Revenue: {formatCurrency(region.totalRevenue)}</p>
                      <p>Orders: {region.orderCount.toLocaleString()}</p>
                      {region.avgDeliveryDays != null && (
                        <p>Avg Delivery: {region.avgDeliveryDays.toFixed(1)} days</p>
                      )}
                      <p>Return Rate: {formatPercent(region.returnRate)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          )}
        </div>
        <div className="w-56 space-y-3 overflow-auto" style={{ maxHeight: 400 }}>
          {selectedRegion && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm font-bold">{selectedRegion.region}</p>
              <p className="text-sm">Revenue: {formatCurrency(selectedRegion.totalRevenue)}</p>
              <p className="text-sm">Orders: {selectedRegion.orderCount.toLocaleString()}</p>
              {selectedRegion.avgDeliveryDays != null && (
                <p className="text-sm">Avg Delivery: {selectedRegion.avgDeliveryDays.toFixed(1)} days</p>
              )}
              <p className="text-sm">Return Rate: {formatPercent(selectedRegion.returnRate)}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-green-700 mb-1">Top 10 Regions</p>
            {data?.topRegions?.map((r) => (
              <div key={r.region} className="flex justify-between text-xs py-0.5 border-b border-gray-100">
                <span className="truncate mr-2">{r.region}</span>
                <span className="font-medium whitespace-nowrap">{formatCurrency(r.totalRevenue)}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-red-700 mb-1">Bottom 10 Regions</p>
            {data?.bottomRegions?.map((r) => (
              <div key={r.region} className="flex justify-between text-xs py-0.5 border-b border-gray-100">
                <span className="truncate mr-2">{r.region}</span>
                <span className="font-medium whitespace-nowrap">{formatCurrency(r.totalRevenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
