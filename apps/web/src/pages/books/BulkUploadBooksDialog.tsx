import { useState, type ChangeEvent } from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import { useBulkUploadBooks, downloadBulkTemplate, type BulkUploadResult } from './useBooks';

interface BulkUploadBooksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// same cap as the api's bulk route
const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function BulkUploadBooksDialog({ open, onOpenChange }: BulkUploadBooksDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkUploadResult | null>(null);

  const { success, error: errorNotify } = useNotifications();
  const bulkUploadMutation = useBulkUploadBooks();

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setResult(null);

    if (picked && !picked.name.toLowerCase().endsWith('.csv')) {
      errorNotify('Only .csv files are allowed');
      e.target.value = '';
      setFile(null);
      return;
    }
    if (picked && picked.size > MAX_CSV_BYTES) {
      errorNotify('File must be 5MB or smaller');
      e.target.value = '';
      setFile(null);
      return;
    }

    setFile(picked);
  };

  const handleUpload = async () => {
    if (!file) return;

    try {
      const uploadResult = await bulkUploadMutation.mutateAsync(file);
      setResult(uploadResult);

      if (uploadResult.created > 0) {
        success(`${uploadResult.created} book(s) created`);
      }
    } catch (err) {
      errorNotify(getApiError(err).message);
    }
  };

  // clear everything when the dialog closes, so it opens fresh next time
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setFile(null);
      setResult(null);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Upload Books</DialogTitle>
          <DialogDescription>
            Upload a CSV with the columns <code>bookName, authorName, isbn, quantity</code>.{' '}
            {/* <button
              type="button"
              className="underline underline-offset-2"
              onClick={downloadBulkTemplate}
            >
              Download template
            </button> */}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input type="file" accept=".csv,text/csv" onChange={handleFileChange} />

          {file && !result && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              {file.name}
            </p>
          )}

          {result && (
            <div className="space-y-3">
              <p className="text-sm">
                <strong>{result.created}</strong> created,{' '}
                <strong className={result.failed.length ? 'text-destructive' : ''}>
                  {result.failed.length}
                </strong>{' '}
                failed
              </p>

              {result.failed.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium w-20">Row</th>
                        <th className="px-3 py-2 text-left font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.failed.map((failure) => (
                        <tr key={failure.row} className="border-t">
                          <td className="px-3 py-2 tabular-nums">{failure.row}</td>
                          <td className="px-3 py-2 text-destructive">
                            {failure.errors.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={handleUpload} disabled={!file} loading={bulkUploadMutation.isPending}>
              Upload
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
