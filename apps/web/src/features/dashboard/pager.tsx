'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { PracticeFormat } from '@/lib/format';

interface CursorPagesState {
  readonly key: string;
  readonly cursors: readonly string[];
  /** What the first page counted: the API counts there only (M05). */
  readonly total: number | null;
}

/**
 * The pages of a cursor list (02 §6): the cursors met on the way, so that "back" knows where it was,
 * and the total the first page told, for the pages after it. Another filter starts at the first page
 * again, without a render of the old one.
 */
export function useCursorPages(filterKey: string): {
  readonly cursor: string | undefined;
  readonly page: number;
  /** A page's total, or on a later page the one the first page told. */
  readonly totalOf: (total: number | null) => number;
  readonly next: (cursor: string, total: number | null) => void;
  readonly previous: () => void;
} {
  const [state, setState] = useState<CursorPagesState>({
    key: filterKey,
    cursors: [],
    total: null,
  });
  const current: CursorPagesState =
    state.key === filterKey ? state : { key: filterKey, cursors: [], total: null };
  return {
    cursor: current.cursors.at(-1),
    page: current.cursors.length + 1,
    totalOf: (total) => total ?? current.total ?? 0,
    next: (cursor, total) => {
      setState({
        ...current,
        cursors: [...current.cursors, cursor],
        total: total ?? current.total,
      });
    },
    previous: () => {
      setState({ ...current, cursors: current.cursors.slice(0, -1) });
    },
  };
}

/** A value once it has stayed the same for a moment: a search asks when the typing pauses. */
export function useSettled<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

/** "Showing 1–20 of 86" and the way to the pages before and after (W5, W8). */
export function Pager({
  page,
  limit,
  count,
  total,
  nextCursor,
  format,
  onNext,
  onPrevious,
}: {
  readonly page: number;
  readonly limit: number;
  /** The rows of this page. */
  readonly count: number;
  readonly total: number;
  readonly nextCursor: string | null;
  readonly format: PracticeFormat;
  readonly onNext: (cursor: string) => void;
  readonly onPrevious: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.pager');
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = (page - 1) * limit + count;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-5 py-3"
    >
      <p className="me-auto text-body-small text-text-secondary">
        {t('showing', {
          from: format.number(first),
          to: format.number(last),
          total: format.number(total),
        })}
      </p>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('previous')}
        isDisabled={page === 1}
        onPress={onPrevious}
      >
        <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
      </Button>
      <p className="text-body-small text-text-primary">
        {t('page', { page: format.number(page), pages: format.number(pages) })}
      </p>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('next')}
        isDisabled={nextCursor === null}
        onPress={() => {
          if (nextCursor !== null) onNext(nextCursor);
        }}
      >
        <ChevronRight aria-hidden className="rtl:-scale-x-100" />
      </Button>
    </nav>
  );
}
