import { createTransport } from 'nodemailer';
import type { Env } from '../../config/env.schema.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The port of the mail provider, which is still open (D10). Tests use an in-memory fake. */
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}

class SmtpEmailSender extends EmailSender {
  private readonly transport;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(url);
  }

  async send(email: Email): Promise<void> {
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
    : new SmtpEmailSender(env.SMTP_URL, env.MAIL_FROM);
}
