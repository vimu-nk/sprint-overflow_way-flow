import { useIsMutating } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/**
 * Green top loader on every route transition and long-running mutation (specs/05 §2).
 * Uses the Figma progress green (#10B981).
 */
export function TopLoader() {
  const routing = useRouterState({ select: (s) => s.status === 'pending' });
  const mutating = useIsMutating({ predicate: (m) => m.meta?.topLoader === true }) > 0;
  const active = routing || mutating;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 200);
    return () => clearTimeout(t);
  }, [active]);
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden" role="progressbar" aria-label="Loading">
      <div className="h-full w-1/3 animate-[toploader_1s_ease-in-out_infinite] bg-ok-bright shadow-[0_0_10px_#10b981,0_0_5px_#10b981]" />
    </div>
  );
}
