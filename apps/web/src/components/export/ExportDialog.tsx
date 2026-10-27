import { useState, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useExport, ExportFormat, ExportColumn } from '@/hooks/useExport';

interface ExportDialogProps {
  resource: string;
  availableColumns: ExportColumn[];
  filters?: Record<string, unknown>;
  title?: string;
  children?: React.ReactNode;
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
    description: 'Best for data import/processing',
  },
  {
    value: 'xlsx',
    label: 'Excel',
    icon: FileSpreadsheet,
    description: 'Best for spreadsheet editing',
  },
  {
    value: 'pdf',
    label: 'PDF',
    icon: File,
    description: 'Best for printing/sharing',
  },
];

export function ExportDialog({
  resource,
  availableColumns,
  filters,
  title,
  children,
}: ExportDialogProps) {
  const { exportData, getPreview, isExporting } = useExport();
  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [previewData, setPreviewData] = useState<{
    preview: Record<string, unknown>[];
    totalCount: number;
  } | null>(null);
  const [, setIsLoadingPreview] = useState(false);

  // Initialize selected columns
  useEffect(() => {
    if (availableColumns.length > 0 && selectedColumns.length === 0) {
      setSelectedColumns(availableColumns.map((col) => col.key));
    }
  }, [availableColumns, selectedColumns.length]);

  // Load preview when dialog opens
  useEffect(() => {
    if (isOpen && !previewData) {
      loadPreview();
    }
  }, [isOpen]);

  const loadPreview = async () => {
    setIsLoadingPreview(true);
    const data = await getPreview(resource, filters);
    if (data) {
      setPreviewData({
        preview: data.preview,
        totalCount: data.totalCount,
      });
    }
    setIsLoadingPreview(false);
  };

  const handleColumnToggle = (columnKey: string) => {
    setSelectedColumns((prev) =>
      prev.includes(columnKey)
        ? prev.filter((key) => key !== columnKey)
        : [...prev, columnKey]
    );
  };

  const handleSelectAll = () => {
    if (selectedColumns.length === availableColumns.length) {
      setSelectedColumns([]);
    } else {
      setSelectedColumns(availableColumns.map((col) => col.key));
    }
  };

  const handleExport = async () => {
    const columns = availableColumns.filter((col) =>
      selectedColumns.includes(col.key)
    );

    const success = await exportData({
      resource,
      format,
      columns,
      filters,
      title,
      orientation,
    });

    if (success) {
      setIsOpen(false);
    }
  };

  const FormatIcon = formatOptions.find((f) => f.value === format)?.icon || FileText;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export {title || resource}</DialogTitle>
          <DialogDescription>
            Configure your export settings and select the columns to include.
            {previewData && (
              <span className="block mt-1 text-primary">
                {previewData.totalCount} records will be exported
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Format Selection */}
          <div className="space-y-2">
            <Label>Export Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as ExportFormat)}
              className="grid grid-cols-3 gap-2"
            >
              {formatOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <div key={option.value}>
                    <RadioGroupItem
                      value={option.value}
                      id={option.value}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={option.value}
                      className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                    >
                      <Icon className="h-5 w-5 mb-1" />
                      <span className="text-sm font-medium">{option.label}</span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {/* PDF Orientation - only for PDF */}
          {format === 'pdf' && (
            <div className="space-y-2">
              <Label>Page Orientation</Label>
              <Select
                value={orientation}
                onValueChange={(value) =>
                  setOrientation(value as 'portrait' | 'landscape')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          {/* Column Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Columns to Export</Label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={handleSelectAll}
              >
                {selectedColumns.length === availableColumns.length
                  ? 'Deselect All'
                  : 'Select All'}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto border rounded-md p-2">
              {availableColumns.map((column) => (
                <div key={column.key} className="flex items-center space-x-2">
                  <Checkbox
                    id={column.key}
                    checked={selectedColumns.includes(column.key)}
                    onCheckedChange={() => handleColumnToggle(column.key)}
                  />
                  <Label
                    htmlFor={column.key}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {column.header}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedColumns.length} of {availableColumns.length} columns selected
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedColumns.length === 0}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <FormatIcon className="h-4 w-4 mr-2" />
                Export as {format.toUpperCase()}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
