import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-white', className)} {...rest} />;
}

export function CardTitle({ children, className, aside }: { children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className="text-[18px] leading-[26px] font-semibold text-brand-ink">{children}</h2>
      {aside}
    </div>
  );
}
