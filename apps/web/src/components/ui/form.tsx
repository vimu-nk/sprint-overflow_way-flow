import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] leading-5 font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="m-0 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="m-0 text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const control = 'w-full rounded-control border border-field bg-white px-4 text-[15px] text-ink disabled:bg-chip aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { big?: boolean }>(function Input({ className, big, ...rest }, ref) {
  return <input ref={ref} className={cn(control, big ? 'h-12 text-base' : 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-3', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { big?: boolean }>(function Select({ className, big, ...rest }, ref) {
  return <select ref={ref} className={cn(control, big ? 'h-12 text-base' : 'h-11', 'pr-8', className)} {...rest} />;
});

/** Segmented control for one-tap choices on phones (Delivered / Partly delivered / Not delivered). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-control bg-chip p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('min-h-12 rounded-[6px] px-2 text-[15px] font-medium', value === o.value ? 'bg-white text-brand-ink shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
