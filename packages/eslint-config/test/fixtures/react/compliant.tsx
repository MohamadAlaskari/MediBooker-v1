// Logical classes, a design token and an in-page link: nothing for the guardrails to report.
export function SyntheticBanner() {
  return (
    <section className="ms-4 text-start" style={{ color: 'var(--color-text-primary)' }}>
      <a href="#add">Synthetic link</a>
    </section>
  );
}
