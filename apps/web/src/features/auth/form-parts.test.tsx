import { ApiError } from '@medibooker/api-client';
import { messages } from '@medibooker/i18n';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm, FormError, PageHeading, SubmitButton } from './form-parts';

describe('FormError', () => {
  function errorText(props: ComponentProps<typeof FormError>): string {
    return renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages.en} timeZone="UTC">
        <FormError {...props} />
      </NextIntlClientProvider>,
    );
  }
  const NOT_FOUND = new ApiError({ status: 404, code: 'NOT_FOUND' });

  it('says what the code means', () => {
    expect(errorText({ error: NOT_FOUND })).toContain(messages.en.errors.NOT_FOUND);
  });

  it('takes other words for a 404 where it is no page that is missing', () => {
    const html = errorText({ error: NOT_FOUND, notFound: 'This time has gone.' });
    expect(html).toContain('This time has gone.');
    expect(html).not.toContain(messages.en.errors.NOT_FOUND);
  });

  it('keeps those words to a 404', () => {
    const html = errorText({
      error: new ApiError({ status: 429, code: 'RATE_LIMITED' }),
      notFound: 'This time has gone.',
    });
    expect(html).toContain(messages.en.errors.RATE_LIMITED);
  });
});

describe('AuthForm', () => {
  function enterIn(button: 'waiting' | 'free') {
    const onSubmit = vi.fn(() => Promise.resolve());
    const preventDefault = vi.fn();
    const form = AuthForm({ onSubmit, children: null }) as ReactElement<ComponentProps<'form'>>;
    form.props.onSubmit?.({
      currentTarget: { querySelector: () => (button === 'waiting' ? {} : null) },
      preventDefault,
    } as never);
    return { onSubmit, preventDefault };
  }

  it('sends a form whose button is free', () => {
    expect(enterIn('free').onSubmit).toHaveBeenCalledOnce();
  });

  // A form of one field has no need of a submit button for Enter to send it, by the HTML standard.
  it('does not send a form again while its button waits, and not by the browser either', () => {
    const { onSubmit, preventDefault } = enterIn('waiting');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

describe('SubmitButton', () => {
  it('is disabled until the page has come to life, so that the browser cannot send a password', () => {
    expect(renderToStaticMarkup(<SubmitButton pending={false}>Send</SubmitButton>)).toMatch(
      /\sdisabled(=|\s|>)/,
    );
  });
});

describe('PageHeading', () => {
  it('can be focused by a script when it is to take the focus on arrival', () => {
    expect(renderToStaticMarkup(<PageHeading title="Step" focusOnArrival />)).toContain(
      'tabindex="-1"',
    );
  });

  it('is an ordinary heading otherwise', () => {
    expect(renderToStaticMarkup(<PageHeading title="Step" />)).not.toContain('tabindex');
  });
});
