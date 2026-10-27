/**
 * Inline image with hover-zoom (cursor-tracked origin) and an onClick hook
 * the parent can wire to a full-screen viewer. Used in:
 *   - the before/after comparison dialog (Replicate enhance, bg removal)
 *   - the regular gallery lightbox (so a normal product preview gets the
 *     same magnify-on-hover behaviour as the comparison view)
 *
 * Reusable knobs:
 *   - `fallbackSrc` swaps in if the primary src 404s — pair with the
 *     workflow's `imageUrl` + `imageUrl_fallback` for upgraded URLs.
 *   - `zoomFactor` and `aspect` let callers tune for thumbnails vs lightboxes
 *     without forking the component.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ZoomableImageProps {
  src: string;
  alt: string;
  /** Original Serper URL (or any retry URL) used if `src` fails to load. */
  fallbackSrc?: string;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: () => void;
  /** When false, hover-zoom and pointer cursor are disabled (e.g. while loading). */
  enabled?: boolean;
  /** Magnification multiplier on hover. Defaults to 2.2x. */
  zoomFactor?: number;
  /** "square" (default, 1:1) or "auto" (intrinsic aspect, capped by container). */
  aspect?: 'square' | 'auto';
  /** Optional overlay (e.g. a loading spinner) rendered above the image. */
  children?: React.ReactNode;
}

export function ZoomableImage({
  src,
  alt,
  fallbackSrc,
  onClick,
  onLoad,
  onError,
  enabled = true,
  zoomFactor = 2.2,
  aspect = 'square',
  children,
}: ZoomableImageProps) {
  const [hover, setHover] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [didFallback, setDidFallback] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  // Sync currentSrc when caller swaps `src` (e.g. flipping between gallery items).
  useEffect(() => {
    setCurrentSrc(src);
    setDidFallback(false);
  }, [src]);

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded border bg-muted/20',
        aspect === 'square' ? 'aspect-square' : 'h-full',
        enabled && 'cursor-zoom-in',
      )}
      onMouseEnter={() => enabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={(e) => {
        if (!enabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setOrigin({ x, y });
      }}
      onClick={enabled ? onClick : undefined}
    >
      <img
        src={currentSrc}
        alt={alt}
        onLoad={onLoad}
        onError={() => {
          if (fallbackSrc && !didFallback && currentSrc !== fallbackSrc) {
            setDidFallback(true);
            setCurrentSrc(fallbackSrc);
            return;
          }
          onError?.();
        }}
        className="h-full w-full object-contain transition-transform duration-150 ease-out"
        style={{
          transform: enabled && hover ? `scale(${zoomFactor})` : 'scale(1)',
          transformOrigin: `${origin.x}% ${origin.y}%`,
        }}
      />
      {children}
    </div>
  );
}
