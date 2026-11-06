import type { ReactNode } from 'react';

/**
 * Every 404 until X06 adds a localized one: the root layouts live under `[locale]`, so a language
 * we lack has no layout to render in. The message is static and bilingual.
 */
export default function GlobalNotFound(): ReactNode {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <main>
          <h1>الصفحة غير موجودة</h1>
          <p lang="en" dir="ltr">
            Page not found.
          </p>
        </main>
      </body>
    </html>
  );
}
