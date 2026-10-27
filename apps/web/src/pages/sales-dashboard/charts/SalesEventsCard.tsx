/**
 * Sales Events Card
 *
 * Displays a table of sales events (football matches, retail events, etc.)
 * within the selected date range.
 */

import { ChartCard } from '../lib/ChartCard';
import type { SalesEvent } from '../types';

interface SalesEventsCardProps {
  events: SalesEvent[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  sporting: 'bg-blue-100 text-blue-800',
  retail: 'bg-orange-100 text-orange-800',
  cultural: 'bg-violet-100 text-violet-800',
  weather: 'bg-green-100 text-green-800',
};

function getCategoryClass(category: string): string {
  return CATEGORY_COLORS[category?.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export default function SalesEventsCard({
  events,
  isLoading,
  isError,
  onRetry,
}: SalesEventsCardProps) {
  const isEmpty = !events || events.length === 0;

  return (
    <ChartCard
      title="Sales Events"
      description="Key events and their impact"
      isLoading={isLoading}
      isError={isError}
      isEmpty={isEmpty}
      onRetry={onRetry}
    >
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Event</th>
              <th className="pb-2 pr-3 font-medium">Category</th>
              <th className="pb-2 pr-3 font-medium">Dates</th>
              <th className="pb-2 font-medium">Region</th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => (
              <tr key={evt.eventId} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">{evt.eventName}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${getCategoryClass(evt.eventCategory)}`}
                  >
                    {evt.eventCategory}
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                  {evt.eventStartDate} &ndash; {evt.eventEndDate}
                </td>
                <td className="py-2 text-muted-foreground">{evt.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
