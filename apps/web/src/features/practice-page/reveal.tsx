'use client';

import { useRef, type ReactNode } from 'react';
import { DURATION_SLOW, EASE_ENTER, gsap, useGSAP } from '@/lib/motion/gsap';

const REVEAL_DISTANCE_PX = 16;

/**
 * Fades a section in when it scrolls into view (P03). The server renders it visible, so without
 * JavaScript and with reduced motion it simply stays in its end state; only `transform` and
 * `opacity` move.
 */
export function Reveal({ children }: { readonly children: ReactNode }): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      // Only on a screen: a printed page has no scrolling that would reveal the section.
      media.add('screen and (prefers-reduced-motion: no-preference)', () => {
        gsap.from(container.current, {
          opacity: 0,
          y: REVEAL_DISTANCE_PX,
          duration: DURATION_SLOW,
          ease: EASE_ENTER,
          scrollTrigger: { trigger: container.current, start: 'top 90%', once: true },
        });
      });
    },
    { scope: container },
  );
  return <div ref={container}>{children}</div>;
}
