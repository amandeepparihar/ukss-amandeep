import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HourlySalesReport } from './HourlySalesReport';
import { MarketplaceSalesReport } from './MarketplaceSalesReport';
import { MarketplaceSyncPerformance } from './MarketplaceSyncPerformance';
import { ShopifySyncPerformance } from './ShopifySyncPerformance';

const TABS = ['hourly', 'marketplace', 'sync', 'shopify-sync'] as const;
type TabValue = (typeof TABS)[number];

export default function SalesPerformancePage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabValue = (TABS as readonly string[]).includes(raw ?? '')
    ? (raw as TabValue)
    : 'hourly';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales Performance</h1>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="hourly">Hourly Sales Performance</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace Sales Performance</TabsTrigger>
          <TabsTrigger value="sync">Marketplace Sync Performance</TabsTrigger>
          <TabsTrigger value="shopify-sync">Shopify Sync Performance</TabsTrigger>
        </TabsList>
        <TabsContent value="hourly"><HourlySalesReport /></TabsContent>
        <TabsContent value="marketplace"><MarketplaceSalesReport /></TabsContent>
        <TabsContent value="sync"><MarketplaceSyncPerformance /></TabsContent>
        <TabsContent value="shopify-sync"><ShopifySyncPerformance /></TabsContent>
      </Tabs>
    </div>
  );
}
