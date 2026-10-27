/**
 * AiImagesSection — Step 3 toolbar knobs (results count, Find More, Upload,
 * Add URL popover). Extracted verbatim from AiGenerationPanel.tsx (no behaviour
 * change): same markup + handlers, moved behind the controller object.
 */

import { Sparkles, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UploadImageButton } from '@/components/file-upload/UploadImageButton';
import { toast } from 'sonner';
import type { AiImagesController } from './useAiImagesSection';

export function AiImagesConfigKnobs({ ctrl }: { ctrl: AiImagesController }) {
  const {
    numberOfResults,
    setNumberOfResults,
    runDifyMore,
    state,
    productInfo,
    exhausted,
    uploadGalleryImage,
    handleUploadComplete,
    pasteUrlOpen,
    setPasteUrlOpen,
    pasteUrlValue,
    setPasteUrlValue,
    pasteUrlError,
    setPasteUrlError,
    handlePasteUrl,
  } = ctrl;

  return (
    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <span>Results</span>
        <Input
          type="number"
          min={0}
          max={20}
          value={numberOfResults}
          onChange={(e) => setNumberOfResults(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
          className="h-6 w-14 text-xs px-1.5"
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 gap-1 text-[11px]"
        onClick={() => runDifyMore()}
        disabled={state === 'searching' || !productInfo || exhausted}
      >
        <Sparkles className="h-3 w-3" />
        {state === 'searching'
          ? 'Searching…'
          : exhausted
          ? 'No more results'
          : 'Find More'}
      </Button>
      <UploadImageButton
        label="Upload"
        size="sm"
        variant="outline"
        className="h-6 gap-1 text-[11px]"
        disabled={!productInfo || state === 'searching'}
        onUpload={uploadGalleryImage}
        onComplete={handleUploadComplete}
        onError={(message) => toast.error(message)}
      />
      <Popover
        open={pasteUrlOpen}
        onOpenChange={(open) => {
          setPasteUrlOpen(open);
          if (!open) {
            setPasteUrlValue('');
            setPasteUrlError(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 text-[11px]"
            disabled={!productInfo || state === 'searching'}
          >
            <LinkIcon className="h-3 w-3" />
            Add URL
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3 space-y-2">
          <div className="space-y-1">
            <p className="text-xs font-medium">Paste an image URL</p>
            <p className="text-[11px] text-muted-foreground">
              Adds the image to the gallery as a new tile. It will only render if the URL points to a publicly reachable image.
            </p>
          </div>
          <Input
            type="url"
            placeholder="https://example.com/photo.jpg"
            value={pasteUrlValue}
            onChange={(e) => {
              setPasteUrlValue(e.target.value);
              if (pasteUrlError) setPasteUrlError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handlePasteUrl();
              }
            }}
            className="h-8 text-xs"
            autoFocus
          />
          {pasteUrlError && (
            <p className="text-[11px] text-red-600">{pasteUrlError}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setPasteUrlOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px]"
              onClick={handlePasteUrl}
              disabled={!pasteUrlValue.trim()}
            >
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
