import type { ReactNode } from 'react';
import { encode } from 'uqr';

/** The quiet zone around the code that scanners need, in modules (ISO/IEC 18004 asks for four). */
const QUIET_ZONE = 4;

/** One path for all dark modules: a square of one module each, moved to its place. */
export function modulePath(data: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${String(x + QUIET_ZONE)} ${String(y + QUIET_ZONE)}h1v1h-1z`);
    });
  });
  return parts.join('');
}

interface QrCodeProps {
  readonly text: string;
  /** What a screen reader says instead of the picture. */
  readonly label: string;
}

/**
 * A QR code drawn as SVG: dark on light in both colour schemes, because scanners read that best,
 * with colours from tokens only and no inline style, which the page's CSP forbids.
 */
export function QrCode({ text, label }: QrCodeProps): ReactNode {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  const side = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(side)} ${String(side)}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full rounded-md bg-bg-surface text-text-primary dark:bg-bg-inverse dark:text-text-inverse"
    >
      <path d={modulePath(data)} fill="currentColor" />
    </svg>
  );
}
