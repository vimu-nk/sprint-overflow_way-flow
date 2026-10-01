import { useEffect, useRef, useState } from 'react';

const PHONE = '(max-width: 767px)';

/**
 * Landing hero (specs/14): muted looping truck video, poster first (LCP), smaller file on phones.
 * Reduced motion, Save-Data or a real playback error fall back to the still poster.
 */
export function HeroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(true);
  const [phone] = useState(() => window.matchMedia(PHONE).matches);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (reduce || saveData) return;
    // Start the video after first paint so the poster stays the LCP element.
    const id = requestAnimationFrame(() => setStill(false));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (still || !v) return;
    // Autoplay is only allowed when muted; React does not reliably set the `muted` attribute,
    // so set the property and start playback explicitly.
    v.muted = true;
    v.defaultMuted = true;
    const onError = () => setStill(true);
    v.addEventListener('error', onError); // the video's own error only, not skipped <source>s
    void v.play().catch(() => {
      // Autoplay blocked (e.g. low-power mode): keep the first frame as a still.
    });
    return () => v.removeEventListener('error', onError);
  }, [still]);

  const poster = phone ? '/hero/hero-poster-720.jpg' : '/hero/hero-poster.jpg';
  return (
    <div className={className} aria-hidden>
      {still ? (
        <img src={poster} alt="" className="h-full w-full object-cover" fetchPriority="high" />
      ) : (
        <video ref={ref} className="h-full w-full object-cover" autoPlay muted loop playsInline preload="auto" poster={poster}>
          {!phone && <source src="/hero/hero-1080.webm" type="video/webm" />}
          <source src={phone ? '/hero/hero-720.mp4' : '/hero/hero-1080.mp4'} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
