/**
 * Inline toolbar used at the top of both the Images and Description sections
 * of the wizard — exposes the shared "Enhance Results" CTA plus undo/redo
 * affordances. Kept generic (no domain-specific copy beyond the CTA label)
 * so either section can drop it in unchanged.
 */
import { Sparkles, Undo2, Redo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SectionToolbarProps {
  onEnhance: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Slot for status / count badges rendered to the right of the buttons. */
  badge?: React.ReactNode;
}

export function SectionToolbar({
  onEnhance,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  badge,
}: SectionToolbarProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs text-purple-700 border-purple-200 hover:bg-purple-50"
        onClick={onEnhance}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Enhance Results
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Undo"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className={cn('h-3.5 w-3.5', canUndo ? 'text-foreground' : 'text-muted-foreground/40')} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Redo"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className={cn('h-3.5 w-3.5', canRedo ? 'text-foreground' : 'text-muted-foreground/40')} />
      </Button>
      {badge}
    </div>
  );
}
