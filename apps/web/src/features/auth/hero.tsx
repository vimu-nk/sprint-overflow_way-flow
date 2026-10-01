import { useEffect, useRef, useState } from 'react';

/**
 * Landing hero (specs/14): muted looping truck video, poster first (LCP), portrait-friendly crop on
 * phones. Reduced motion, Save-Data or a playback error fall back to the still poster.
 */
export function HeroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(true);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (reduce || saveData) return;
    // Start the video after first paint so the poster stays the LCP element.
    const id = requestAnimationFrame(() => setStill(false));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={className} aria-hidden>
      {still ? (
        <picture>
          <source media="(max-width: 767px)" srcSet="/hero/hero-poster-720.jpg" />
          <img src="/hero/hero-poster.jpg" alt="" className="h-full w-full object-cover" fetchPriority="high" />
        </picture>
      ) : (
        <video ref={ref} className="h-full w-full object-cover" autoPlay muted loop playsInline preload="metadata" poster="/hero/hero-poster.jpg" onError={() => setStill(true)}>
          <source src="/hero/hero-720.mp4" type="video/mp4" media="(max-width: 767px)" />
          <source src="/hero/hero-1080.webm" type="video/webm" />
          <source src="/hero/hero-1080.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
