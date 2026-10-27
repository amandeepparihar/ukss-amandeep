import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload } from 'lucide-react';
import { useBannerConfig, useSaveBannerConfig } from './hooks/useDailyDeals';

interface BannerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function validateImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to read image'));
    img.src = URL.createObjectURL(file);
  });
}

export function BannerConfigDialog({ open, onOpenChange }: BannerConfigDialogProps) {
  const { data, isLoading } = useBannerConfig();
  const saveMutation = useSaveBannerConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const banner = data?.data as { title: string; imageFilename: string; imageUrl: string } | undefined;

  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [fileError, setFileError] = useState('');

  // Populate form when dialog opens / data loads
  useEffect(() => {
    if (open && banner) {
      setTitle(banner.title);
      setSelectedFile(null);
      setPreviewUrl(banner.imageUrl);
      setFileError('');
    }
  }, [open, banner]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError('');

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(banner?.imageUrl || '');
      return;
    }

    // Validate type
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setFileError('Only JPG, PNG, and WEBP images are allowed');
      return;
    }

    // Validate size
    if (file.size > 512000) {
      setFileError('Image must be under 500KB');
      return;
    }

    // Validate filename length
    if (file.name.length > 64) {
      setFileError('Filename must be under 64 characters');
      return;
    }

    // Validate dimensions
    try {
      const { width, height } = await validateImageDimensions(file);
      if (width !== 275 || height !== 275) {
        setFileError(`Image must be exactly 275x275 pixels (got ${width}x${height})`);
        return;
      }
    } catch {
      setFileError('Failed to read image dimensions');
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSave = () => {
    if (!title.trim()) return;

    if (selectedFile) {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('file', selectedFile);
      saveMutation.mutate(formData, {
        onSuccess: () => { onOpenChange(false); },
      });
      return;
    }

    saveMutation.mutate({ title: title.trim() }, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Banner Configuration</DialogTitle>
          <DialogDescription>
            Update the Daily Deals homepage banner title and image (275x275).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-4">
            {/* Banner Title */}
            <div className="space-y-2">
              <Label htmlFor="banner-title">Banner Title</Label>
              <Input
                id="banner-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                placeholder="e.g. DAILY DEALS"
              />
              <p className="text-xs text-muted-foreground">{title.length}/100 characters</p>
            </div>

            {/* Current Image Preview */}
            {previewUrl && (
              <div className="space-y-2">
                <Label>Current Image</Label>
                <div className="border rounded p-2 flex justify-center bg-muted/50">
                  <img
                    src={previewUrl}
                    alt="Banner preview"
                    className="max-w-[275px] max-h-[275px] object-contain"
                  />
                </div>
              </div>
            )}

            {/* File Upload */}
            <div className="space-y-2">
              <Label htmlFor="banner-image">Upload New Image</Label>
              <div className="flex gap-2">
                <Input
                  ref={fileInputRef}
                  id="banner-image"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={handleFileChange}
                  className="flex-1"
                />
                {selectedFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedFile(null);
                      setPreviewUrl(banner?.imageUrl || '');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Required: 275x275 pixels, JPG/PNG/WEBP, max 500KB
              </p>
              {fileError && (
                <p className="text-xs text-destructive">{fileError}</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || !title.trim() || !!fileError}
          >
            <Upload className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
