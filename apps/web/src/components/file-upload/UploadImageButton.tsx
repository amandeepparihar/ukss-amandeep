import { useRef, useState, type ChangeEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getApiError } from '@/lib/api';

/**
 * Minimal "click to pick a single image and run an async handler" button.
 * Sibling of `FileUpload` — that one is a full drag-drop zone with previews
 * and is the right choice for upload pages. THIS one is the right choice
 * inside toolbars and dialogs where a single button + spinner is all you need.
 *
 * Reusable across:
 *   - Step 3 image gallery (upload your own product image)
 *   - Step 4 description enhance dialog (attach a reference photo)
 *   - any future surface that wants a one-click image picker
 *
 * The caller owns the upload itself (so each surface can target a different
 * endpoint and decide what to do with the result). The component just handles
 * the file picker, MIME guard, busy state, and error surfacing.
 */
export interface UploadImageButtonProps<TResult> {
  /** Caller-supplied uploader. Receives the picked File, returns whatever the
   *  caller wants to do with the result (URL, upload-file-id, etc.). */
  onUpload: (file: File) => Promise<TResult>;
  /** Fires after a successful upload, with the resolved value. */
  onComplete?: (result: TResult) => void;
  /** Fires when the upload throws or the file fails the MIME guard. Receives
   *  a friendly error message — caller decides whether to toast / inline / log. */
  onError?: (message: string) => void;
  /** Button text. Defaults to "Upload". */
  label?: string;
  /** Disable the button (e.g. when the parent is at a selection cap). */
  disabled?: boolean;
  /** Accepted MIME types — also passed to `<input accept>`. Defaults to common
   *  raster image types. */
  accept?: string;
  /** Client-side max file size in bytes. Defaults to 5MB to match the backend cap. */
  maxBytes?: number;
  /** Button size — proxies to the shadcn Button. Defaults to `sm`. */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Button variant — proxies to the shadcn Button. Defaults to `outline`. */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'link' | 'destructive';
  /** Extra classes for the trigger button. */
  className?: string;
  /** When true, render only the icon (no text). Pairs with `size="icon"`. */
  iconOnly?: boolean;
}

const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function UploadImageButton<TResult>({
  onUpload,
  onComplete,
  onError,
  label = 'Upload',
  disabled = false,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  size = 'sm',
  variant = 'outline',
  className,
  iconOnly = false,
}: UploadImageButtonProps<TResult>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const acceptedMimes = accept.split(',').map((s) => s.trim().toLowerCase());

  const handlePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same filename
    if (!file) return;

    if (!acceptedMimes.includes(file.type.toLowerCase())) {
      onError?.(`Unsupported image type: ${file.type || 'unknown'}`);
      return;
    }
    if (file.size > maxBytes) {
      onError?.(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB; max ${(maxBytes / 1024 / 1024).toFixed(0)}MB)`);
      return;
    }

    setBusy(true);
    try {
      const result = await onUpload(file);
      onComplete?.(result);
    } catch (err) {
      onError?.(getApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(iconOnly ? '' : 'gap-1.5', className)}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className={cn('animate-spin', iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5')} />
        ) : (
          <Upload className={iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        )}
        {!iconOnly && (busy ? 'Uploading…' : label)}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handlePicked}
      />
    </>
  );
}
