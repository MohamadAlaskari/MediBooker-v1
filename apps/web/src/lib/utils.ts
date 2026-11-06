import { createCn } from 'cn/config';

/** The type styles of the design tokens, as their `text-…` utilities are named. */
export const TYPE_STYLES = [
  'display',
  'heading-h1',
  'heading-h2',
  'heading-h3',
  'body-large',
  'body-default',
  'body-small',
  'label-large',
  'label-default',
  'label-small',
  'caption',
];

/**
 * Merges classes, and knows our type tokens. Out of the box it reads an unknown `text-…` as a
 * colour, so `text-label-large` next to `text-text-brand` would silently disappear.
 */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: TYPE_STYLES }] } },
});
