export interface FormattingOptions {
  /** Unicode numbering system of the practice, for example `latn` or `arab`. */
  readonly numberingSystem?: string | undefined;
  /** Hour cycle of the practice, for example `h12` or `h23`. */
  readonly hourCycle?: string | undefined;
}

/** A locale whose dates and numbers follow the practice's settings: `ar-u-nu-arab-hc-h23`. */
export function toFormattingLocale(
  locale: string,
  { numberingSystem, hourCycle }: FormattingOptions = {},
): string {
  const extensions = [
    ...(numberingSystem === undefined ? [] : ['nu', numberingSystem]),
    ...(hourCycle === undefined ? [] : ['hc', hourCycle]),
  ];
  return extensions.length === 0 ? locale : `${locale}-u-${extensions.join('-')}`;
}
