import { useState } from 'react';
import { Download, FileText, FileSpreadsheet, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useExport, ExportFormat, ExportColumn } from '@/hooks/useExport';

interface ExportButtonProps {
  resource: string;
  columns?: ExportColumn[];
  filters?: Record<string, unknown>;
  title?: string;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const formatOptions: {
  value: ExportFormat;
  label: string;
  icon: typeof FileText;
  description: string;
}[] = [
  {
    value: 'csv',
    label: 'CSV',
    icon: FileText,
    description: 'Comma-separated values',
  },
  {
    value: 'xlsx',
    label: 'Excel',
    icon: FileSpreadsheet,
    description: 'Microsoft Excel spreadsheet',
  },
  {
    value: 'pdf',
    label: 'PDF',
    icon: File,
    description: 'Portable Document Format',
  },
];

export function ExportButton({
  resource,
  columns,
  filters,
  title,
  disabled = false,
  variant = 'outline',
  size = 'default',
}: ExportButtonProps) {
  const { exportData, isExporting } = useExport();
  const [isOpen, setIsOpen] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    setIsOpen(false);
    await exportData({
      resource,
      format,
      columns,
      filters,
      title,
    });
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled || isExporting}
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {isExporting ? 'Exporting...' : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Export Format</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {formatOptions.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleExport(option.value)}
              className="cursor-pointer"
            >
              <Icon className="h-4 w-4 mr-2" />
              <div className="flex flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
