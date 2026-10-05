import { Link } from '@tanstack/react-router';
import { ChevronRight, Home } from 'lucide-react';
import { Fragment } from 'react';

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumb below the role home (specs/05 §4). The middle collapses to "…" on phones. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-[13px] text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const middle = i > 0 && !last;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <li className={middle && items.length > 3 ? 'hidden sm:inline-flex' : 'inline-flex items-center'}>
                {last || !c.to ? (
                  <span aria-current={last ? 'page' : undefined} className={last ? 'font-medium text-ink' : ''}>
                    {c.label}
                  </span>
                ) : (
                  <Link to={c.to} className="inline-flex items-center gap-1 text-muted hover:text-ink">
                    {i === 0 && <Home className="size-3.5" aria-hidden />}
                    {c.label}
                  </Link>
                )}
              </li>
              {i === 1 && items.length > 3 && (
                <li className="inline-flex sm:hidden" aria-hidden>
                  <ChevronRight className="size-3.5" />…
                </li>
              )}
              {!last && (
                <li aria-hidden className={middle && items.length > 3 ? 'hidden sm:inline-flex' : 'inline-flex'}>
                  <ChevronRight className="size-3.5" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
