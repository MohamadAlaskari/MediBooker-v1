// Fixture for nextjs.json: DOM libraries (iterable NodeList) and Node types; plain TS, no JSX.
export function rightToLeftElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[dir="rtl"]')];
}

export const isProductionBuild: boolean = process.env.NODE_ENV === 'production';
