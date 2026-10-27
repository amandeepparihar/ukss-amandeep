/**
 * Reusable themed confirmation dialog.
 *
 * Two ways to use:
 *
 * 1. Imperative (recommended) — `useConfirm` hook returns a function that
 *    resolves to `true` if the user confirmed, `false` if cancelled:
 *
 *      const confirm = useConfirm();
 *      const ok = await confirm({
 *        title: 'Delete user?',
 *        description: 'This cannot be undone.',
 *        confirmLabel: 'Delete',
 *        variant: 'destructive',
 *      });
 *      if (ok) deleteMutation.mutate(...);
 *
 *    Requires `<ConfirmProvider>` mounted near the top of the React tree
 *    (in `main.tsx` alongside `<Toaster>`).
 *
 * 2. Declarative — `<ConfirmDialog>` rendered inline with controlled state.
 *    Useful when the caller wants to drive open/close itself or render
 *    description as JSX with embedded `<code>` etc.
 *
 *      <ConfirmDialog
 *        open={open}
 *        onOpenChange={setOpen}
 *        title="…"
 *        description={<>This will <code>x</code></>}
 *        variant="destructive"
 *        confirmLabel="Delete"
 *        onConfirm={() => mutation.mutate(...)}
 *        pending={mutation.isPending}
 *      />
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared options shape
// ---------------------------------------------------------------------------

export type ConfirmVariant = 'default' | 'destructive';

export interface ConfirmOptions {
  /** Bold title row. */
  title: React.ReactNode;
  /** Description body — can be plain string or JSX (for inline <code>, lists, …). */
  description?: React.ReactNode;
  /** Confirm-button label. Defaults to "Confirm" / "Delete" based on variant. */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** "destructive" applies red styling to the confirm button. */
  variant?: ConfirmVariant;
  /**
   * Optional async work tied to the confirm button.
   *
   * When provided, the dialog stays open with a pending state (spinner +
   * disabled buttons) until the promise settles. This avoids the "did my
   * click do anything?" gap on slow operations like link-quantity, which
   * can take 1-2 s while the server fans out updates across several tables.
   *
   * On resolve → dialog closes, `confirm()` resolves to `true`.
   * On reject → dialog closes, the error propagates via a thrown rejection
   * so React Query / standard try/catch error flows are preserved.
   */
  run?: () => Promise<unknown>;
}

const defaultConfirmLabel = (v: ConfirmVariant) =>
  v === 'destructive' ? 'Delete' : 'Confirm';

// ---------------------------------------------------------------------------
// Declarative component
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when user clicks the confirm button. The dialog stays open until
   *  the caller flips `open` to false — this lets you keep it open while a
   *  mutation is pending. */
  onConfirm: () => void;
  /** Shown as the confirm-button label and disables both buttons. */
  pending?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  pending = false,
}: ConfirmDialogProps) {
  const label = confirmLabel ?? defaultConfirmLabel(variant);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description != null && (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              // Prevent the default Radix behaviour of auto-closing, so the
              // caller controls dismissal via `pending`/`onOpenChange`.
              e.preventDefault();
              onConfirm();
            }}
            className={cn(
              variant === 'destructive' &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            )}
          >
            {pending ? `${label}…` : label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Imperative API — Provider + useConfirm hook
// ---------------------------------------------------------------------------

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface State {
  open: boolean;
  options: ConfirmOptions;
}

const EMPTY_OPTIONS: ConfirmOptions = { title: '' };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ open: false, options: EMPTY_OPTIONS });
  const [pending, setPending] = useState(false);
  // We hold the resolver + rejector on refs so async settlement can't race
  // against a re-render.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const rejectorRef = useRef<((reason: unknown) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve, reject) => {
      resolverRef.current = resolve;
      rejectorRef.current = reject;
      setState({ open: true, options: opts });
      setPending(false);
    });
  }, []);

  // If the provider unmounts (e.g. a route change) while a confirm() promise is
  // still pending, settle it so the awaiting caller can't hang forever.
  useEffect(() => {
    return () => {
      rejectorRef.current?.(new Error('ConfirmProvider unmounted'));
      resolverRef.current = null;
      rejectorRef.current = null;
    };
  }, []);

  const closeAndResolve = useCallback((value: boolean) => {
    setState((s) => ({ ...s, open: false }));
    setPending(false);
    resolverRef.current?.(value);
    resolverRef.current = null;
    rejectorRef.current = null;
  }, []);

  const closeAndReject = useCallback((reason: unknown) => {
    setState((s) => ({ ...s, open: false }));
    setPending(false);
    rejectorRef.current?.(reason);
    resolverRef.current = null;
    rejectorRef.current = null;
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Block dismissal while async `run` is in flight — matches the same
      // contract ConfirmDialog enforces for declarative `pending`.
      if (pending) return;
      if (!next) {
        // Dismissed via overlay click / Escape / Cancel button.
        closeAndResolve(false);
      }
    },
    [pending, closeAndResolve]
  );

  const handleConfirm = useCallback(async () => {
    const run = state.options.run;
    if (!run) {
      closeAndResolve(true);
      return;
    }
    // Async path: keep dialog open with pending state until `run` settles.
    setPending(true);
    try {
      await run();
      closeAndResolve(true);
    } catch (err) {
      // Propagate so callers using `try { await confirm({run}) } catch` (or
      // the page's mutation-onError surface via the original throw) still
      // see the failure.
      closeAndReject(err);
    }
  }, [state.options.run, closeAndResolve, closeAndReject]);

  // The Provider's confirm function is stable; consumers can call it inside
  // useCallback dependencies without invalidating them every render.
  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={state.open}
        onOpenChange={handleOpenChange}
        onConfirm={handleConfirm}
        title={state.options.title}
        description={state.options.description}
        confirmLabel={state.options.confirmLabel}
        cancelLabel={state.options.cancelLabel}
        variant={state.options.variant}
        pending={pending}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      'useConfirm must be used inside <ConfirmProvider>. Mount it once near the top of the React tree (alongside <Toaster> in main.tsx).'
    );
  }
  return ctx;
}
