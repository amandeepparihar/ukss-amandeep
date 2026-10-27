import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsNotSoldTab } from './ProductsNotSoldTab';
import { SingleSizeTab } from './SingleSizeTab';
import { DealsSalesReport } from './DealsSalesReport';

export default function DailyDealsPage() {
  const [productType, setProductType] = useState<'all' | 'adults' | 'womens' | 'kids'>('all');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Deals"
        description="Schedule daily deals from your slow-moving stock"
      />

      <DealsSalesReport />

      {/* Listing Tabs */}
      <Tabs defaultValue="not-sold" className="w-full">
        <TabsList>
          <TabsTrigger value="not-sold">Slow Moving Products</TabsTrigger>
          <TabsTrigger value="single-size">Single Size Slow Moving Products</TabsTrigger>
        </TabsList>

        <TabsContent value="not-sold" className="mt-4">
          <ProductsNotSoldTab productType={productType} onProductTypeChange={setProductType} />
        </TabsContent>

        <TabsContent value="single-size" className="mt-4">
          <SingleSizeTab productType={productType} onProductTypeChange={setProductType} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
