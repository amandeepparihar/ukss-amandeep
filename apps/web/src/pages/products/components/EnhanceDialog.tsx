/**
 * Shared "Enhance" prompt dialog used by Step 3 (Images) and Step 4
 * (Description). Renders:
 *   - a free-text prompt
 *   - optional gallery thumbnails the user can attach
 *   - optional "paste a URL or upload a file" row for custom references
 *
 * The dialog is fully controlled by the caller and only knows about
 * `EnhanceImageRef` objects — backend's `toDifyImageFileList` accepts exactly
 * this shape, so callers can pass the result straight through.
 */
import { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, X } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { UploadImageButton } from '@/components/file-upload/UploadImageButton';
import { safeHostname } from '../utils/difyParse';

/** Image-pick option shown in EnhanceDialog when caller supplies `imageOptions`.
 *  Reusable across any future enhance flow that wants to attach reference
 *  images for a vision-enabled LLM (description, attributes, future tagging). */
export interface EnhanceImageOption {
  url: string;
  label?: string;
}

/** Ref shape forwarded to the onApply callback. Each entry is either a remote
 *  URL (gallery pick / pasted URL) or a Dify upload-file-id (returned by an
 *  upload endpoint the caller wires via `onUploadFile`). Backend's
 *  `toDifyImageFileList` accepts exactly this shape. */
export type EnhanceImageRef = { url: string } | { uploadFileId: string };

/** Internal draft state — adds preview/label/filename so chips can render
 *  thumbnails and titles without re-fetching anything. */
type EnhanceRefDraft =
  | { kind: 'gallery'; url: string; label?: string }
  | { kind: 'url'; url: string }
  | { kind: 'upload'; uploadFileId: string; previewUrl: string; filename: string };

export interface EnhanceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  /** When provided, renders an image-attachment grid inside the dialog. The
   *  selected refs are forwarded to onApply alongside the prompt. Omit for
   *  prompt-only flows (existing image-search refinement uses this shape). */
  imageOptions?: EnhanceImageOption[];
  /** Hard cap matches the Dify file-list workflow input limit. */
  maxImages?: number;
  /** When true, render the "Or attach your own" row (URL paste + file upload).
   *  Caller MUST also supply `onUploadFile` for the file-upload button to work. */
  enableCustomUpload?: boolean;
  /** Caller-supplied uploader: receives the picked File, returns the Dify
   *  upload-file-id. Keeps the dialog API-agnostic — wherever you need
   *  uploads, point this at your upload endpoint. */
  onUploadFile?: (file: File) => Promise<{ uploadFileId: string }>;
  onApply?: (prompt: string, refs?: EnhanceImageRef[]) => void;
}

export function EnhanceDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  imageOptions,
  maxImages = 5,
  enableCustomUpload = false,
  onUploadFile,
  onApply,
}: EnhanceDialogProps) {
  const [text, setText] = useState('');
  const [selectedRefs, setSelectedRefs] = useState<EnhanceRefDraft[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Reset everything whenever the dialog closes so reopening starts fresh.
  // Local object-URL previews from file uploads are revoked too.
  useEffect(() => {
    if (!open) {
      setText('');
      setSelectedRefs((prev) => {
        prev.forEach((r) => {
          if (r.kind === 'upload' && r.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(r.previewUrl);
          }
        });
        return [];
      });
      setUrlInput('');
      setUploadError(null);
    }
  }, [open]);

  const atLimit = selectedRefs.length >= maxImages;

  const toggleGalleryRef = (opt: EnhanceImageOption) => {
    setSelectedRefs((prev) => {
      const exists = prev.findIndex((r) => r.kind === 'gallery' && r.url === opt.url);
      if (exists >= 0) return prev.filter((_, i) => i !== exists);
      if (prev.length >= maxImages) return prev;
      return [...prev, { kind: 'gallery', url: opt.url, label: opt.label }];
    });
  };

  const removeRefAt = (idx: number) => {
    setSelectedRefs((prev) => {
      const target = prev[idx];
      if (target?.kind === 'upload' && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const addUrlRef = () => {
    const u = urlInput.trim();
    if (!u) return;
    try {
      // Light validation — full URL parsing weeds out obvious typos.
      // eslint-disable-next-line no-new
      new URL(u);
    } catch {
      setUploadError('That doesn\'t look like a valid URL');
      return;
    }
    if (selectedRefs.length >= maxImages) return;
    if (selectedRefs.some((r) => (r.kind === 'url' || r.kind === 'gallery') && r.url === u)) {
      setUploadError('That URL is already attached');
      return;
    }
    setSelectedRefs((prev) => [...prev, { kind: 'url', url: u }]);
    setUrlInput('');
    setUploadError(null);
  };

  const showGalleryPicker = !!imageOptions && imageOptions.length > 0;
  const showCustomRow = enableCustomUpload;
  const canSubmit = text.trim().length > 0 || selectedRefs.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="resize-none"
        />

        {(showGalleryPicker || showCustomRow) && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Reference images (optional) — the AI can read attributes like
              neckline, sleeve length, badges, and detailing directly from the image.
            </span>
            <span>{selectedRefs.length}/{maxImages}</span>
          </div>
        )}

        {showGalleryPicker && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              From the search results
            </div>
            <div className="grid grid-cols-4 gap-2">
              {imageOptions.map((opt) => {
                const selected = selectedRefs.some((r) => r.kind === 'gallery' && r.url === opt.url);
                const disabled = !selected && atLimit;
                return (
                  <button
                    key={opt.url}
                    type="button"
                    onClick={() => toggleGalleryRef(opt)}
                    disabled={disabled}
                    className={cn(
                      'relative aspect-square overflow-hidden rounded border-2 transition-colors',
                      selected ? 'border-purple-500 ring-2 ring-purple-200' : 'border-border',
                      disabled && 'opacity-40 cursor-not-allowed',
                    )}
                    title={opt.label ?? opt.url}
                  >
                    <img
                      src={opt.url}
                      alt={opt.label ?? ''}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {selected && (
                      <span className="absolute top-0.5 right-0.5 rounded-full bg-purple-500 p-0.5">
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showCustomRow && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Or attach your own
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="url"
                placeholder="Paste an image URL…"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUploadError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrlRef(); } }}
                disabled={atLimit}
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addUrlRef}
                disabled={atLimit || !urlInput.trim()}
              >
                Add
              </Button>
              {/*
                Use the shared UploadImageButton so this dialog stops carrying
                its own hidden file-input + busy-state plumbing — see the
                button's JSDoc for the contract. We pipe the picked File
                through the caller-supplied `onUploadFile` (the dialog itself
                stays API-agnostic) and keep the File around to mint a local
                blob preview for the attached-chip thumbnail.
              */}
              <UploadImageButton<{ uploadFileId: string; file: File }>
                size="sm"
                variant="outline"
                label="Upload"
                disabled={atLimit || !onUploadFile}
                onUpload={async (file) => {
                  if (!onUploadFile) {
                    throw new Error('Upload handler not configured');
                  }
                  if (selectedRefs.length >= maxImages) {
                    throw new Error('Attachment limit reached');
                  }
                  const { uploadFileId } = await onUploadFile(file);
                  return { uploadFileId, file };
                }}
                onComplete={({ uploadFileId, file }) => {
                  const previewUrl = URL.createObjectURL(file);
                  setSelectedRefs((prev) => [
                    ...prev,
                    { kind: 'upload', uploadFileId, previewUrl, filename: file.name },
                  ]);
                  setUploadError(null);
                }}
                onError={(msg) => setUploadError(msg)}
              />
            </div>
            {uploadError && (
              <p className="text-[10px] text-red-600">{uploadError}</p>
            )}
          </div>
        )}

        {selectedRefs.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Attached ({selectedRefs.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedRefs.map((ref, i) => {
                const previewSrc = ref.kind === 'upload' ? ref.previewUrl : ref.url;
                const label =
                  ref.kind === 'gallery' ? (ref.label ?? safeHostname(ref.url))
                  : ref.kind === 'upload' ? ref.filename
                  : safeHostname(ref.url);
                return (
                  <div
                    key={`${ref.kind}-${i}`}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-muted/30 pl-1 pr-2 py-0.5"
                  >
                    <img src={previewSrc} alt="" className="h-5 w-5 rounded-full object-cover" />
                    <span className="text-[10px] max-w-[140px] truncate" title={label}>
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRefAt(i)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              const refs: EnhanceImageRef[] | undefined =
                selectedRefs.length > 0
                  ? selectedRefs.map((r) =>
                      r.kind === 'upload'
                        ? { uploadFileId: r.uploadFileId }
                        : { url: r.url },
                    )
                  : undefined;
              onApply?.(text.trim(), refs);
              onOpenChange(false);
            }}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
