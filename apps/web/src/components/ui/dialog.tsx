import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

/** Accessible modal built on <dialog> (focus trap and Escape for free). Full-height sheet on phones. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={cn(
        'm-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-card border border-line bg-white p-0 text-ink backdrop:bg-black/40 sm:m-auto sm:rounded-card',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
      )}
      aria-label={title}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="m-0 text-[18px] font-semibold text-brand-ink">{title}</h2>
            <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-control hover:bg-chip" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
