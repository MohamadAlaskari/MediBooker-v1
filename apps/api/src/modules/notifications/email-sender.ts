import { createTransport } from 'nodemailer';
import type { Env } from '../../config/env.schema.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The port of the mail provider: SMTP fits any of them (D10). Tests use an in-memory fake. */
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}

/**
 * How long a mail server may stay silent, instead of nodemailer's defaults of up to ten minutes. This
 * bounds silence, not a whole message: the deadline per message and the lease per row follow with N01.
 */
const SMTP_TIMEOUTS_MS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** What nodemailer gets. Exported for its test: how it reads an encoded password is its choice. */
export function smtpOptionsOf(url: string) {
  return { url, ...SMTP_TIMEOUTS_MS };
}

/** MAIL_ALLOWED_RECIPIENTS refused it. The code shows in the log; the address never does. */
class RecipientNotAllowedError extends Error {
  readonly code = 'RECIPIENT_NOT_ALLOWED';

  constructor() {
    super('recipient not allowed');
    this.name = 'RecipientNotAllowedError';
  }
}

class SmtpEmailSender extends EmailSender {
  private readonly transport;

  constructor(
    url: string,
    private readonly from: string,
    private readonly allowedRecipients: readonly string[] | undefined,
  ) {
    super();
    try {
      this.transport = createTransport(smtpOptionsOf(url));
    } catch {
      // Not its error: that holds the URL with the password, and this runs while the application
      // starts, where Nest prints an error unfiltered.
      throw new Error('SMTP_URL not usable');
    }
  }

  async send(email: Email): Promise<void> {
    if (
      this.allowedRecipients !== undefined &&
      !this.allowedRecipients.includes(email.to.toLowerCase())
    ) {
      throw new RecipientNotAllowedError();
    }
    await this.transport.sendMail({ from: this.from, ...email });
  }
}

/** SMTP_URL unset: nothing can be sent, so messages wait and retry instead of being lost. */
class UnconfiguredEmailSender extends EmailSender {
  send(): Promise<void> {
    return Promise.reject(new Error('no mail provider configured'));
  }
}

export function emailSenderFor(env: Env): EmailSender {
  return env.SMTP_URL === undefined
    ? new UnconfiguredEmailSender()
    : new SmtpEmailSender(env.SMTP_URL, env.MAIL_FROM, env.MAIL_ALLOWED_RECIPIENTS);
}
