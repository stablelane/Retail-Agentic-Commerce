"use client";

import { useEffect, useRef } from "react";

/** Decorative muted background loop; hidden when the user prefers reduced motion. */
export function HeroVideo({ src, poster }: { src: string; poster?: string | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // SSR doesn't emit the muted attribute reliably, and browsers only autoplay muted media.
    video.muted = true;
    video.play().catch(() => undefined);
  }, []);

  return (
    <video
      ref={ref}
      aria-hidden="true"
      tabIndex={-1}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      {...(poster ? { poster } : {})}
      className="pointer-events-none absolute inset-0 size-full object-cover object-center motion-reduce:hidden"
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
