import {
  ApiError,
  createTestQueryClient,
  getGetPublicAvailabilityQueryKey,
} from '@medibooker/api-client';
import { messages } from '@medibooker/i18n';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FreeTimesChooser } from './free-times-picker';

const SLUG = 'al-noor';
const SERVICE = '10000000-0000-4000-8000-000000000001';
const LINA = '20000000-0000-4000-8000-000000000001';
const PHONE = '+966 11 000 0000';
const FREE_DAY = { date: '2026-11-08', hasFreeTimes: true };
const FREE_DAY_LONG = 'Sunday, November 8';
const { freeTimes } = messages.en.practicePage;

function render(
  props: Partial<ComponentProps<typeof FreeTimesChooser>> = {},
  client: QueryClient = createTestQueryClient(),
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages.en} timeZone="UTC">
      <QueryClientProvider client={client}>
        <FreeTimesChooser
          slug={SLUG}
          locale="en"
          settings={{ numberingSystem: 'latn', hourCycle: 'h23', timeZone: 'Asia/Riyadh' }}
          today={FREE_DAY.date}
          weekStart={7}
          services={[{ id: SERVICE, label: 'Check-up' }]}
          doctors={[{ id: LINA, name: 'Dr. Lina', initials: 'LM' }]}
          phone={PHONE}
          action={{ href: '/en/book/al-noor', onChoose: () => undefined }}
          {...props}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const AVAILABILITY = getGetPublicAvailabilityQueryKey(SLUG, { serviceId: SERVICE });

function withFreeDay(failure?: ApiError): QueryClient {
  const client = createTestQueryClient();
  client.setQueryData(AVAILABILITY, { days: [FREE_DAY] });
  if (failure !== undefined) {
    client
      .getQueryCache()
      .find({ queryKey: AVAILABILITY })
      ?.setState({ status: 'error', error: failure });
  }
  return client;
}

/** The name of the doctor who is chosen in the list of doctors. */
function chosenDoctor(html: string): string | undefined {
  return /aria-checked="true".*?<bdi>([^<]*)<\/bdi>/.exec(html)?.[1];
}

describe('FreeTimesChooser', () => {
  it('starts on any doctor, as on a public page', () => {
    expect(chosenDoctor(render())).toBe(freeTimes.anyDoctor);
  });

  it('starts on the doctor it is given, and any doctor stays a choice', () => {
    const html = render({ initialProviderId: LINA });
    expect(chosenDoctor(html)).toBe('Dr. Lina');
    expect(html).toContain(freeTimes.anyDoctor);
  });

  it('starts on any doctor when the one it is given has left the list', () => {
    const gone = '20000000-0000-4000-8000-000000000002';
    expect(chosenDoctor(render({ initialProviderId: gone }))).toBe(freeTimes.anyDoctor);
  });

  it('starts on any doctor for an appointment without a named one', () => {
    expect(chosenDoctor(render({ initialProviderId: null }))).toBe(freeTimes.anyDoctor);
  });

  it('heads the day below the heading of its page', () => {
    const client = withFreeDay();
    expect(render({}, client)).toMatch(new RegExp(`<h3[^>]*>${FREE_DAY_LONG}</h3>`));
    expect(render({ dayHeadingLevel: 'h2' }, client)).toMatch(
      new RegExp(`<h2[^>]*>${FREE_DAY_LONG}</h2>`),
    );
  });

  it('keeps every day at the width of a target, and a phone gets the weekday in one letter', () => {
    const html = render({}, withFreeDay());
    expect(html).toContain('grid-cols-[repeat(7,minmax(var(--spacing-touch-target),1fr))]');
    expect(html).toContain('<span class="tablet:hidden">S</span>');
    expect(html).toContain('<span class="hidden tablet:inline">Sun</span>');
  });

  it('reads a service that is no longer online like nothing free, with the phone and no retry', () => {
    const html = render({}, withFreeDay(new ApiError({ status: 404, code: 'NOT_FOUND' })));
    expect(html).toContain(freeTimes.empty);
    expect(html).toContain(PHONE);
    expect(html).not.toContain(freeTimes.retry);
    // A poll that ends in a 404 also takes away what an earlier one found.
    expect(html).not.toContain(FREE_DAY_LONG);
  });

  it('offers another try for a failure that can pass, with the phone too', () => {
    const html = render({}, withFreeDay(new ApiError({ status: 503, code: 'INTERNAL_ERROR' })));
    expect(html).toContain(freeTimes.error);
    expect(html).toContain(freeTimes.retry);
    expect(html).toContain(PHONE);
  });

  it('draws its own focus ring, which `outline-none` would hide', () => {
    expect(render({}, withFreeDay())).not.toContain('outline-none');
  });
});
