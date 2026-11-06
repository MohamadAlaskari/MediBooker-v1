import type { ReactNode } from 'react';

interface MessagePageProps {
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}

/** A full page with one message: not found, unavailable, an error. */
export function MessagePage({ title, body, children }: MessagePageProps): ReactNode {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-page flex-col items-center justify-center px-4 text-center"
    >
      <h1 className="text-heading-h1 text-text-primary">{title}</h1>
      <p className="mt-2 text-body-default text-text-secondary">{body}</p>
      {children}
    </main>
  );
}
