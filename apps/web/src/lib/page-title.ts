import { isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import type { MessageKeys, Messages, NestedKeyOf } from 'next-intl';
import { getTranslations } from 'next-intl/server';

type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

interface RouteProps {
  readonly params: Promise<{ readonly locale: string }>;
}

/**
 * `generateMetadata` for a page with a title of its own. Every page is a new document, and its title
 * is what a screen reader announces on arrival and what tells two tabs apart (WCAG 2.4.2). Always a
 * fixed text and never a service or a practice: a title stays in the browser's history, where those
 * say something about someone.
 */
export function pageTitle(key: MessageKey): (props: RouteProps) => Promise<Metadata> {
  return async ({ params }) => {
    const { locale } = await params;
    // The root layout answers an unknown language with a 404.
    if (!isLocale(locale)) return {};
    const t = await getTranslations({ locale });
    return { title: t('app.pageTitle', { page: t(key) }) };
  };
}
