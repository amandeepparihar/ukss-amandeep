import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function SummaryCard({
  title,
  count,
  variant,
  active,
  onClick,
}: {
  title: string;
  count: number;
  variant: 'error' | 'warning' | 'healthy' | 'neutral' | 'success';
  active?: boolean;
  onClick?: () => void;
}) {
  const colorClasses =
    variant === 'neutral'
      ? 'text-foreground'
      : variant === 'success' || variant === 'healthy'
        ? 'text-green-600'
        : count === 0
          ? 'text-green-600'
          : variant === 'error'
            ? 'text-red-600'
            : 'text-yellow-600';

  return (
    <Card
      className={cn(
        onClick && 'cursor-pointer transition-shadow hover:shadow-md',
        active && 'ring-2 ring-primary',
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-bold ${colorClasses}`}>{count}</p>
      </CardContent>
    </Card>
  );
}
