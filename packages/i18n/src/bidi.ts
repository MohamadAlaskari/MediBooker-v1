const LEFT_TO_RIGHT_ISOLATE = '⁦';
const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/** Keeps a Latin snippet such as a phone number intact inside right-to-left plain text. */
export function isolateLtr(text: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * Keeps text someone wrote, in whatever language, from reordering the sentence around it: for a
 * value inside a message, where `<bdi>` cannot go (health-data-security §11).
 */
export function isolate(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
