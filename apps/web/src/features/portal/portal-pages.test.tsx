import {
  ApiError,
  createTestQueryClient,
  getGetMeQueryKey,
  getGetMyAppointmentQueryKey,
  getGetProfileQueryKey,
  getGetPublicPracticeQueryKey,
  getListMyAppointmentsInPracticeQueryKey,
  getListMyAppointmentsQueryKey,
  getListMyPracticesQueryKey,
  type AppointmentDto,
  type MyPracticeDto,
  type PublicPracticeDto,
} from '@medibooker/api-client';
import { isolate, messages } from '@medibooker/i18n';
import { QueryClientProvider, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppointmentDetailsPage } from './appointment-details-page';
import { AppointmentsPage, PastOfPractice } from './appointments-page';
import { Booked, BookPage, Review } from './book-page';
import { Confirm, ReschedulePage } from './reschedule-page';
import { JoinStep } from './practice-details-steps';

const { portal, errors, auth } = messages.en;
/** Up to its apostrophe, which the HTML writes as an entity. */
const NO_PRACTICES = portal.list.noPractices.split("'")[0] ?? '';

const PRACTICE_ID = '40000000-0000-4000-8000-000000000001';
const APPOINTMENT_ID = '50000000-0000-4000-8000-000000000001';
const SERVICE_ID = '10000000-0000-4000-8000-000000000001';
const DOCTOR_ID = '20000000-0000-4000-8000-000000000001';
const SLUG = 'al-noor';
const PHONE = '+966 11 000 0000';

const PRACTICE = {
  id: PRACTICE_ID,
  slug: SLUG,
  name: 'Al Noor',
  phone: PHONE,
  address: '12 Al Noor Street',
  cancellationDeadlineHours: 24,
  numberingSystem: 'latn',
  hourCycle: 'h23',
  timeZone: 'Asia/Riyadh',
  today: '2026-11-08',
  weekStart: 7,
  insuranceTypes: ['SELF_PAY'],
  insuranceProviderTypes: [],
  insuranceNumberTypes: [],
  services: [{ id: SERVICE_ID, name: 'Check-up', description: null, durationMinutes: 30 }],
  team: [
    {
      id: DOCTOR_ID,
      title: 'Dr.',
      firstName: 'Lina',
      lastName: 'Mansour',
      isProvider: true,
    },
  ],
} as unknown as PublicPracticeDto;

const MY_PRACTICE: MyPracticeDto = {
  id: PRACTICE_ID,
  slug: SLUG,
  name: { en: 'Al Noor' },
  capacity: 'PATIENT',
};

function appointment(overrides: Partial<AppointmentDto> = {}): AppointmentDto {
  return {
    id: APPOINTMENT_ID,
    practiceId: PRACTICE_ID,
    patientId: '60000000-0000-4000-8000-000000000001',
    serviceId: SERVICE_ID,
    serviceName: { en: 'Check-up' },
    providerId: DOCTOR_ID,
    providerName: 'Dr. Lina Mansour',
    startsAt: '2026-11-20T06:00:00Z',
    endsAt: '2026-11-20T06:30:00Z',
    timeZone: 'Asia/Riyadh',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    status: 'BOOKED',
    bookedAt: '2026-11-08T05:00:00Z',
    changeableUntil: '2026-11-19T06:00:00Z',
    changeable: true,
    started: false,
    ...overrides,
  };
}

const LIMITED = new ApiError({ status: 429, code: 'RATE_LIMITED' });
const NOT_FOUND = new ApiError({ status: 404, code: 'NOT_FOUND' });

const APPOINTMENT = getGetMyAppointmentQueryKey(PRACTICE_ID, APPOINTMENT_ID);
const LIST = getListMyAppointmentsQueryKey();
const PRACTICES = getListMyPracticesQueryKey();
const PAGE = getGetPublicPracticeQueryKey(SLUG);
const ME = getGetMeQueryKey();
const PROFILE = getGetProfileQueryKey();
const PAST = getListMyAppointmentsInPracticeQueryKey(PRACTICE_ID, { scope: 'past' });

/** A query with its answer, and on it an error when the next look failed. */
function answered(client: QueryClient, key: QueryKey, data: unknown, error?: ApiError): void {
  client.setQueryData(key, data);
  if (error !== undefined)
    client.getQueryCache().find({ queryKey: key })?.setState({ error, status: 'error' });
}

/** A query whose first read failed. */
function failed(client: QueryClient, key: QueryKey, error: ApiError): void {
  client.getQueryCache().build(client, { queryKey: key }).setState({ error, status: 'error' });
}

function clientWith(seed: (client: QueryClient) => void): QueryClient {
  const client = createTestQueryClient();
  // A first render reports what is known, as a page that is on the screen does.
  client.setDefaultOptions({ queries: { retryOnMount: false, staleTime: Infinity } });
  seed(client);
  return client;
}

function render(
  ui: ReactNode,
  seed: (client: QueryClient) => void = () => undefined,
  locale: 'ar' | 'en' = 'en',
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      <QueryClientProvider client={clientWith(seed)}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** What a person reads: without tags, and with the characters that keep a name whole. */
function textOf(html: string): string {
  return html.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ');
}

const noop = (): void => undefined;

describe('the list of appointments', () => {
  const list = (items: readonly AppointmentDto[], missing: readonly object[] = []): object => ({
    items,
    unavailablePractices: missing,
  });
  const withPractices = (client: QueryClient): void => {
    answered(client, PRACTICES, { items: [MY_PRACTICE] });
  };

  it('says there is nothing only when nothing is missing either', () => {
    const empty = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([]));
    });
    expect(empty).toContain(portal.list.empty);

    for (const reason of ['TIMEOUT', 'UNAVAILABLE', 'LIMIT']) {
      const partial = render(<AppointmentsPage />, (client) => {
        withPractices(client);
        answered(client, LIST, list([], [{ practiceId: PRACTICE_ID, reason }]));
      });
      expect(partial).not.toContain(portal.list.empty);
    }
  });

  it('isolates each name of a practice it could not read', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([], [{ practiceId: PRACTICE_ID, reason: 'TIMEOUT' }]));
    });
    expect(html).toContain(isolate('Al Noor'));
  });

  it('says that it may be out of date, with another try, when the last look failed', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([appointment()]), LIMITED);
    });
    expect(html).toContain(portal.list.stale);
    expect(html).toContain(portal.list.retry);
  });

  it('names each control with its row, starting with the word on it', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([appointment()]));
    });
    const named = `${isolate('Check-up')}, Friday, November 20, 2026, 09:00`;
    expect(html).toContain(`aria-label="${named}: details of this appointment"`);
    expect(html).toContain(`aria-label="Reschedule ${named}"`);
    expect(html).toContain(`aria-label="Cancel ${named}"`);
  });

  it('says to call the practice for an appointment too close to change, and offers no change', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([appointment({ changeable: false })]));
    });
    expect(textOf(html)).toContain(
      `${portal.appointment.tooLate} ${portal.appointment.callNowOnly}`,
    );
    expect(html).not.toContain('aria-label="Cancel ');
  });

  it('keeps the status region on the page before it has anything to say', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([appointment()]));
    });
    expect(html).toContain('<div role="status"></div>');
  });

  it('offers to book only from a list of practices that loaded', () => {
    const failing = render(<AppointmentsPage />, (client) => {
      failed(client, PRACTICES, LIMITED);
      answered(client, LIST, list([appointment()]));
    });
    expect(failing).not.toContain(NO_PRACTICES);
    expect(failing).toContain(errors.RATE_LIMITED);
    expect(failing).toContain(portal.list.retry);

    const waiting = render(<AppointmentsPage />, (client) => {
      answered(client, LIST, list([appointment()]));
    });
    expect(waiting).not.toContain(NO_PRACTICES);

    const none = render(<AppointmentsPage />, (client) => {
      answered(client, PRACTICES, { items: [] });
      answered(client, LIST, list([]));
    });
    expect(none).toContain(NO_PRACTICES);
  });

  it('isolates the name in the way to book at a practice', () => {
    const html = render(<AppointmentsPage />, (client) => {
      withPractices(client);
      answered(client, LIST, list([]));
    });
    expect(html).toContain(`Book at ${isolate('Al Noor')}`);
  });

  it('keeps a Latin name that starts with a number whole on an Arabic page', () => {
    const html = render(
      <AppointmentsPage />,
      (client) => {
        answered(client, PRACTICES, {
          items: [{ ...MY_PRACTICE, name: { ar: '24 Stunden Praxis' } }],
        });
        answered(client, LIST, list([appointment({ serviceName: { ar: '24-Stunden-EKG' } })]));
      },
      'ar',
    );
    expect(html).toContain(`aria-label="إلغاء ${isolate('24-Stunden-EKG')}،`);
    expect(html).toContain(`احجز لدى ${isolate('24 Stunden Praxis')}`);
  });
});

describe('the history of a practice', () => {
  const past = (seed: (client: QueryClient) => void): string =>
    render(<PastOfPractice practice={MY_PRACTICE} onChanged={noop} />, seed);
  /** Axe's `list`: anything but an item directly in a list. */
  const onlyItemsInList = (html: string): boolean => /<ul[^>]*><li[ >]/.test(html);

  it('stays a list while it loads', () => {
    expect(onlyItemsInList(past(noop))).toBe(true);
  });

  it('stays a list when it is empty', () => {
    const html = past((client) => {
      answered(client, PAST, { items: [], nextCursor: null });
    });
    expect(html).toContain(portal.list.emptyPast);
    expect(onlyItemsInList(html)).toBe(true);
  });

  it('stays a list when it fails, with another try', () => {
    const html = past((client) => {
      failed(client, PAST, LIMITED);
    });
    expect(html).toContain(errors.RATE_LIMITED);
    expect(html).toContain(portal.list.retry);
    expect(onlyItemsInList(html)).toBe(true);
  });

  it('leads back here from the details of a row, and gives the year', () => {
    const html = past((client) => {
      answered(client, PAST, {
        items: [appointment({ status: 'COMPLETED', changeable: false, started: true })],
        nextCursor: null,
      });
    });
    expect(html).toContain(`${APPOINTMENT_ID}#from=past`);
    expect(html).toContain('Friday, November 20, 2026');
  });

  it('calls a visit that has begun neither booked nor too close', () => {
    const html = past((client) => {
      answered(client, PAST, {
        items: [appointment({ changeable: false, started: true })],
        nextCursor: null,
      });
    });
    expect(html).toContain(portal.status.STARTED);
    expect(html).toContain('data-variant="neutral"');
    expect(html).not.toContain(portal.status.BOOKED);
    expect(html).not.toContain(portal.appointment.tooLate);
  });
});

describe('the details of an appointment', () => {
  const details = (seed: (client: QueryClient) => void): string =>
    render(
      <AppointmentDetailsPage practiceId={PRACTICE_ID} appointmentId={APPOINTMENT_ID} />,
      seed,
    );
  const known = (client: QueryClient, shown: AppointmentDto): void => {
    answered(client, APPOINTMENT, shown);
    answered(client, PRACTICES, { items: [MY_PRACTICE] });
    answered(client, PAGE, PRACTICE);
  };

  it('offers the calendar and the changes while it can be changed', () => {
    const html = details((client) => {
      known(client, appointment());
    });
    expect(html).toContain(portal.details.manage);
    expect(html).toContain(portal.cancel.confirm);
    expect(html).toContain(portal.list.reschedule);
    expect(html).toContain('<div role="status"></div>');
  });

  it('has nothing to manage for a visit that has begun, and no word of a deadline', () => {
    const html = details((client) => {
      known(client, appointment({ changeable: false, started: true }));
    });
    expect(html).toContain(portal.status.STARTED);
    expect(html).not.toContain(portal.details.manage);
    expect(html).not.toContain(portal.book.addToCalendar);
    expect(html).not.toContain(portal.appointment.tooLate);
  });

  it('says to call now when it is too late, with the number and without "after that"', () => {
    const html = details((client) => {
      known(client, appointment({ changeable: false }));
    });
    expect(html).toContain(portal.appointment.tooLate);
    expect(html).toContain('Please call');
    expect(html).not.toContain('After that');
    expect(html).toContain(portal.book.addToCalendar);
  });

  it('writes the hours of the deadline with the digits of the practice', () => {
    const html = details((client) => {
      known(client, appointment({ numberingSystem: 'arab' }));
    });
    expect(html).toContain('٢٤ hours');
  });

  it('leaves out the row of the practice when its name is not known', () => {
    const html = details((client) => {
      answered(client, APPOINTMENT, appointment());
      failed(client, PRACTICES, LIMITED);
    });
    expect(html).not.toContain(portal.appointment.practice);
  });

  it('has a heading and the way back when there is nothing to show', () => {
    const html = details((client) => {
      failed(client, APPOINTMENT, NOT_FOUND);
    });
    expect(html).toContain(`>${portal.details.title}</h1>`);
    expect(html).toContain(portal.details.notFound);
    expect(html).toContain('href="/en/appointments"');
  });

  it('says that it may be out of date when the last look failed', () => {
    const html = details((client) => {
      answered(client, APPOINTMENT, appointment(), LIMITED);
      answered(client, PRACTICES, { items: [MY_PRACTICE] });
    });
    expect(html).toContain(portal.list.stale);
  });
});

describe('moving an appointment', () => {
  const page = (seed: (client: QueryClient) => void): string =>
    render(<ReschedulePage practiceId={PRACTICE_ID} appointmentId={APPOINTMENT_ID} />, seed);
  const known = (client: QueryClient, shown: AppointmentDto): void => {
    answered(client, APPOINTMENT, shown);
    answered(client, PRACTICES, { items: [MY_PRACTICE] });
    answered(client, PAGE, PRACTICE);
  };

  it('offers the chooser while it can be changed', () => {
    const html = page((client) => {
      known(client, appointment());
    });
    expect(html).toContain(portal.reschedule.title);
    expect(html).toContain(messages.en.practicePage.freeTimes.doctor);
  });

  it('offers no chooser past its deadline: the status, whom to call, and the way to its details', () => {
    const html = page((client) => {
      known(client, appointment({ changeable: false }));
    });
    expect(html).toContain(portal.reschedule.closedTitle);
    expect(html).toContain(portal.status.BOOKED);
    expect(html).toContain(portal.appointment.tooLate);
    expect(html).toContain('Please call');
    expect(html).toContain(`href="/en/appointments/${PRACTICE_ID}/${APPOINTMENT_ID}"`);
    expect(html).not.toContain(messages.en.practicePage.freeTimes.doctor);
    expect(html).not.toContain('Your appointment now');
  });

  it('does not call a cancelled one "your appointment now"', () => {
    const html = page((client) => {
      known(client, appointment({ status: 'CANCELLED', changeable: false }));
    });
    expect(html).toContain(portal.status.CANCELLED);
    expect(html).toContain(portal.reschedule.closedCancelled);
    expect(html).not.toContain('Your appointment now');
    expect(html).not.toContain(portal.appointment.tooLate);
  });

  it('says that a practice has no page only when it has none', () => {
    const none = page((client) => {
      answered(client, APPOINTMENT, appointment());
      answered(client, PRACTICES, { items: [MY_PRACTICE] });
      failed(client, PAGE, NOT_FOUND);
    });
    expect(none).toContain(portal.reschedule.noPage);
    expect(none).not.toContain(portal.list.retry);

    const noSlug = page((client) => {
      answered(client, APPOINTMENT, appointment());
      answered(client, PRACTICES, { items: [{ ...MY_PRACTICE, slug: null }] });
    });
    expect(noSlug).toContain(portal.reschedule.noPage);
  });

  it('offers another try when the practice could not be read, and does not call that no page', () => {
    const html = page((client) => {
      answered(client, APPOINTMENT, appointment());
      answered(client, PRACTICES, { items: [MY_PRACTICE] });
      failed(client, PAGE, LIMITED);
    });
    expect(html).toContain(errors.RATE_LIMITED);
    expect(html).toContain(portal.list.retry);
    expect(html).not.toContain(portal.reschedule.noPage);
  });

  it('keeps the chooser when only a later look at the practice fails', () => {
    const html = page((client) => {
      answered(client, APPOINTMENT, appointment());
      answered(client, PRACTICES, { items: [MY_PRACTICE] });
      answered(client, PAGE, PRACTICE, LIMITED);
    });
    expect(html).toContain(messages.en.practicePage.freeTimes.doctor);
    expect(html).not.toContain(portal.reschedule.noPage);
  });

  it('offers another try when the list of practices could not be read', () => {
    const html = page((client) => {
      answered(client, APPOINTMENT, appointment());
      failed(client, PRACTICES, LIMITED);
    });
    expect(html).toContain(portal.list.retry);
    expect(html).not.toContain(portal.reschedule.noPage);
  });

  it('has a heading and the way back for an appointment it cannot find', () => {
    const html = page((client) => {
      failed(client, APPOINTMENT, NOT_FOUND);
      answered(client, PRACTICES, { items: [MY_PRACTICE] });
    });
    expect(html).toContain(`>${portal.reschedule.title}</h1>`);
    expect(html).toContain(portal.details.notFound);
    expect(html).toContain('href="/en/appointments"');
  });

  describe('the last word', () => {
    const confirm = (props: { error?: unknown; pending?: boolean; doctor?: string }): string =>
      render(
        <Confirm
          from="Friday"
          to="Sunday"
          doctor={props.doctor}
          pending={props.pending ?? false}
          error={props.error ?? null}
          onConfirm={noop}
          onOther={noop}
        />,
      );

    it('names the doctor it moves to', () => {
      expect(confirm({ doctor: 'Dr. Lina Mansour' })).toContain(
        `Doctor: ${isolate('Dr. Lina Mansour')}`,
      );
    });

    it('says when it is the practice that assigns one', () => {
      expect(confirm({})).toContain(portal.reschedule.practiceAssigns);
    });

    it('lets nobody choose another time while the move runs', () => {
      const html = confirm({ pending: true });
      expect(html).toMatch(/<button[^>]*disabled[^>]*>Choose another time/);
    });

    it.each([
      'SLOT_NOT_AVAILABLE',
      'APPOINTMENT_OVERLAP',
      'OUTSIDE_BOOKING_WINDOW',
      'SERVICE_NOT_BOOKABLE',
    ])('offers no second press after %s, only another time', (code) => {
      const html = confirm({ error: new ApiError({ status: 409, code }) });
      expect(html).not.toContain(portal.reschedule.confirm);
      expect(html).toContain(portal.reschedule.other);
      expect(html).not.toContain('href="/en/appointments"');
    });

    it('says that a time has gone, where a 404 would read as a page that is not there', () => {
      const html = confirm({ error: NOT_FOUND });
      expect(html).toContain(portal.book.timeGone);
      expect(html).not.toContain(errors.NOT_FOUND);
      expect(html).not.toContain(portal.reschedule.confirm);
    });

    it.each([
      ['a move elsewhere', new ApiError({ status: 409, code: 'INVALID_STATUS_TRANSITION' })],
      ['a passed deadline', new ApiError({ status: 409, code: 'CANCELLATION_DEADLINE_PASSED' })],
      ['a lost answer', new ApiError({ status: 0, code: 'NETWORK_ERROR' })],
      ['a failure of the server', new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE' })],
    ])('leads to the appointments after %s, with no second press', (_name, error) => {
      const html = confirm({ error });
      expect(html).not.toContain(portal.reschedule.confirm);
      expect(html).toContain('href="/en/appointments"');
    });

    it('keeps the press after a refusal that can pass', () => {
      expect(confirm({ error: LIMITED })).toContain(portal.reschedule.confirm);
    });
  });
});

describe('booking', () => {
  const ACCOUNT = { id: 'a', email: 'sami@example.test', emailVerified: true, locale: 'en' };
  const page = (seed: (client: QueryClient) => void): string =>
    render(<BookPage slug={SLUG} practiceHref={`/en/${SLUG}`} />, seed);

  it('has a heading and the way back for a practice it cannot find', () => {
    const html = page((client) => {
      answered(client, ME, ACCOUNT);
      answered(client, PRACTICES, { items: [] });
      failed(client, PAGE, NOT_FOUND);
    });
    expect(html).toContain(`>${portal.book.title}</h1>`);
    expect(html).toContain(portal.book.notFound);
    expect(html).toContain('href="/en/appointments"');
  });

  it('offers another try for a failure that can pass', () => {
    const html = page((client) => {
      failed(client, ME, LIMITED);
      answered(client, PRACTICES, { items: [] });
      answered(client, PAGE, PRACTICE);
    });
    expect(html).toContain(errors.RATE_LIMITED);
    expect(html).toContain(portal.list.retry);
  });

  describe('its confirmation', () => {
    it('promises a change when the appointment can be changed', () => {
      const html = render(<Booked appointment={appointment()} practice={PRACTICE} />);
      expect(html).toContain(portal.book.bookedBody);
    });

    it('says to call the practice when it is already too close', () => {
      const html = render(
        <Booked appointment={appointment({ changeable: false })} practice={PRACTICE} />,
      );
      expect(html).toContain(portal.book.bookedBodyCall);
      expect(html).not.toContain(portal.book.bookedBody);
    });

    it('leaves out the row of the practice without its name and address', () => {
      const html = render(
        <Booked
          appointment={appointment()}
          practice={{ ...PRACTICE, name: null, address: null }}
        />,
      );
      expect(html).not.toContain(portal.appointment.practice);
    });
  });

  describe('its review', () => {
    const CHOICE = { slug: SLUG, serviceId: SERVICE_ID, startsAt: '2026-11-22T06:00:00Z' };
    const review = (props: { providerId?: string; note?: string } = {}): string =>
      render(
        <Review
          practice={PRACTICE}
          service={{
            id: SERVICE_ID,
            name: 'Check-up',
            description: null,
            durationMinutes: 30,
            referralRequired: false,
          }}
          choice={{ ...CHOICE, providerId: props.providerId }}
          note={props.note ?? ''}
          onNoteChange={noop}
          onBooked={noop}
          onIncomplete={noop}
          timesHref={`/en/${SLUG}#free-times`}
        />,
      );

    it('shows what is booked, with the doctor chosen', () => {
      const html = review({ providerId: DOCTOR_ID });
      expect(html).toContain(portal.book.confirm);
      expect(html).toContain('Dr. Lina Mansour');
      expect(html).toContain('Sunday, November 22, 2026');
    });

    it('stops before the last press when the doctor has left the page, and leads to the times', () => {
      const html = review({ providerId: '20000000-0000-4000-8000-000000000002' });
      expect(html).toContain(portal.book.doctorGoneTitle);
      expect(html).not.toContain(portal.book.confirm);
      expect(html).toContain(`href="/en/${SLUG}#free-times"`);
    });

    it('keeps the note it is given, and takes no more than the API does', () => {
      const html = review({ note: 'Synthetic reason' });
      expect(html).toContain('Synthetic reason');
      expect(html).toContain('maxLength="500"');
    });
  });
});

describe('the first booking at a practice', () => {
  const PERSON = {
    firstName: 'Sami',
    lastName: 'Beispiel',
    dateOfBirth: '1990-04-12',
    phone: null,
    insuranceType: 'SELF_PAY',
    insuranceProvider: null,
    insuranceNumberEnd: null,
  };
  const step = (seed: (client: QueryClient) => void, practice = PRACTICE): string =>
    render(<JoinStep practice={practice} onDone={noop} />, seed);

  it('keeps the form when only a later look at the profile fails', () => {
    const html = step((client) => {
      answered(client, PROFILE, PERSON, LIMITED);
    });
    expect(html).toContain(auth.details.firstName);
    expect(html).not.toContain(errors.RATE_LIMITED);
  });

  it('starts empty for a person who entered nothing yet', () => {
    const html = step((client) => {
      failed(client, PROFILE, NOT_FOUND);
    });
    expect(html).toContain(auth.details.firstName);
    expect(html).not.toContain(errors.NOT_FOUND);
  });

  it('offers another try when the profile could not be read, under a heading', () => {
    const html = step((client) => {
      failed(client, PROFILE, LIMITED);
    });
    expect(html).toContain(errors.RATE_LIMITED);
    expect(html).toContain(portal.list.retry);
    expect(html).toContain('<h1');
    expect(html).not.toContain(auth.details.firstName);
  });

  it('isolates the name of the practice in its sentences', () => {
    const html = step((client) => {
      answered(client, PROFILE, PERSON);
    });
    expect(html).toContain(`Your details for ${isolate('Al Noor')}`);
  });

  it('has words of its own for a practice without a name', () => {
    const html = step(
      (client) => {
        answered(client, PROFILE, PERSON);
      },
      { ...PRACTICE, name: null },
    );
    expect(html).toContain(`Your details for ${portal.list.somePractice}`);
  });

  it('takes the focus to its heading only when a press brought the person here', () => {
    expect(
      step((client) => {
        answered(client, PROFILE, PERSON);
      }),
    ).not.toContain('tabindex="-1"');
    expect(
      render(<JoinStep practice={PRACTICE} focusOnArrival onDone={noop} />, (client) => {
        answered(client, PROFILE, PERSON);
      }),
    ).toContain('tabindex="-1"');
  });
});
