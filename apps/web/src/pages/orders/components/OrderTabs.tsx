/**
 * Ship-by-date tabs — five filter tabs above the listing table.
 * Requirements: REQ-02-017
 */

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { TabCounts } from '../hooks/useOrders';

export type TabKey = 'today' | 'tomorrow' | 'twoDays' | 'afterTwoDays' | 'toBeRefund';

interface OrderTabsProps {
  activeTab: TabKey | undefined;
  onTabChange: (tab: TabKey | undefined) => void;
  counts: TabCounts | undefined;
  isLoading: boolean;
}

const TAB_CONFIG: Array<{ key: TabKey; label: string; countKey: keyof TabCounts }> = [
  { key: 'today', label: 'Ship By Today', countKey: 'today' },
  { key: 'tomorrow', label: 'Ship By Tomorrow', countKey: 'tomorrow' },
  { key: 'twoDays', label: 'Ship By Two Days', countKey: 'twoDays' },
  { key: 'afterTwoDays', label: 'Ship After Two Days', countKey: 'afterTwoDays' },
  { key: 'toBeRefund', label: 'To Be Refund', countKey: 'toBeRefund' },
];

export function OrderTabs({ activeTab, onTabChange, counts, isLoading }: OrderTabsProps) {
  return (
    <Tabs
      value={activeTab ?? 'all'}
      onValueChange={(val) => onTabChange(val === 'all' ? undefined : val as TabKey)}
    >
      <TabsList className="flex flex-wrap h-auto gap-1">
        <TabsTrigger value="all" className="text-xs">
          All Orders
        </TabsTrigger>
        {TAB_CONFIG.map(({ key, label, countKey }) => (
          <TabsTrigger key={key} value={key} className="text-xs">
            {label}
            {counts && !isLoading && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {counts[countKey]}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
