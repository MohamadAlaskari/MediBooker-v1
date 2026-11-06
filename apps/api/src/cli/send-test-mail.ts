/**
 * Control menu "Test-E-Mail senden": one e-mail through the configured mail server, so a wrong
 * password shows at once and not only as retries of the outbox. One JSON line with the host of the
 * server, never its URL, which holds the password, and the codes of a failure, never its message,
 * which can name the recipient; exit 1 when it failed. Reads the environment of the API, like main.ts.
 */
import { z } from 'zod';
import { parseEnv } from '../config/env.schema.js';
import { loadWorkspaceEnv } from '../config/load-env.js';
import { emailSenderFor } from '../modules/notifications/email-sender.js';

loadWorkspaceEnv(import.meta.dirname, process.env.NODE_ENV);

const TEXT = 'The mail server of MediBooker works.';

function report(result: { readonly sent: boolean; readonly [key: string]: unknown }): void {
  process.stdout.write(`${JSON.stringify({ command: 'mail:test', ...result })}\n`);
  process.exitCode = result.sent ? 0 : 1;
}

const env = parseEnv(process.env);
const server = env.SMTP_URL === undefined ? null : new URL(env.SMTP_URL).hostname;
const recipient = z.email().safeParse(process.argv[2]);

if (recipient.success) {
  try {
    await emailSenderFor(env).send({
      to: recipient.data,
      subject: 'MediBooker: test e-mail',
      text: TEXT,
      html: `<p>${TEXT}</p>`,
    });
    report({ sent: true, server });
  } catch (error) {
    const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
    report({ sent: false, server, code, responseCode });
  }
} else {
  report({ sent: false, server, code: 'NO_RECIPIENT' });
}
