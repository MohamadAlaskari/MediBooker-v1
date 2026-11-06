'use client';

import type { ReactNode } from 'react';

/**
 * The last resort, when the root layout itself fails (03 §5): it has no language from the path and
 * no catalogue to rely on, so its message is static and bilingual.
 */
export default function GlobalError(): ReactNode {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <main>
          <h1>حدث خطأ غير متوقع</h1>
          <p lang="en" dir="ltr">
            Something went wrong.
          </p>
        </main>
      </body>
    </html>
  );
}
