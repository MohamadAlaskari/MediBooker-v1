import { createServer, type Server, type Socket } from 'node:net';
import { inspect } from 'node:util';
import { createTransport } from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env.schema.js';
import { emailSenderFor, smtpOptionsOf } from './email-sender.js';

const ENV = {
  APP_ENV: 'local',
  PLATFORM_DATABASE_URL: 'postgresql://user@localhost:5432/test',
  MAIL_FROM: 'MediBooker <box@example.test>',
};

/** Just enough of a mail server: the conversation of one e-mail, and what it was told. */
function fakeMailServer() {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      const text = String(chunk);
      received.push(text);
      if (text.endsWith('\r\n.\r\n') || text.startsWith('EHLO') || text.startsWith('MAIL')) {
        socket.write('250 ok\r\n');
      } else if (text.startsWith('RCPT')) {
        socket.write('250 ok\r\n');
      } else if (text.startsWith('DATA')) {
        socket.write('354 go on\r\n');
      } else if (text.startsWith('QUIT')) {
        socket.end('221 bye\r\n');
      }
    });
  });
  return { server, received };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

const EMAIL = { to: 'patient@example.test', subject: 'Betreff', text: 'Text', html: '<p>Text</p>' };

let running: Server | undefined;

afterEach(() => {
  running?.close();
  running = undefined;
});

describe('emailSenderFor', () => {
  it('keeps a message for later when no mail server is configured', async () => {
    await expect(emailSenderFor(parseEnv(ENV)).send(EMAIL)).rejects.toThrow(
      'no mail provider configured',
    );
  });

  it('sends from MAIL_FROM to the recipient through SMTP_URL', async () => {
    const { server, received } = fakeMailServer();
    running = server;
    const port = await listen(server);
    await emailSenderFor(parseEnv({ ...ENV, SMTP_URL: `smtp://127.0.0.1:${String(port)}` })).send(
      EMAIL,
    );
    const conversation = received.join('');
    expect(conversation).toContain('MAIL FROM:<box@example.test>');
    expect(conversation).toContain('RCPT TO:<patient@example.test>');
    expect(conversation).toContain('Subject: Betreff');
  });

  it('sends only to the allowed recipients, in any spelling, and tells the server of no other', async () => {
    const { server, received } = fakeMailServer();
    running = server;
    const port = await listen(server);
    const sender = emailSenderFor(
      parseEnv({
        ...ENV,
        SMTP_URL: `smtp://127.0.0.1:${String(port)}`,
        MAIL_ALLOWED_RECIPIENTS: 'Patient@example.test',
      }),
    );
    await sender.send({ ...EMAIL, to: 'PATIENT@example.test' });
    await expect(sender.send({ ...EMAIL, to: 'stranger@example.test' })).rejects.toMatchObject({
      code: 'RECIPIENT_NOT_ALLOWED',
      message: 'recipient not allowed',
    });
    expect(received.join('')).toContain('RCPT TO:<PATIENT@example.test>');
    expect(received.join('')).not.toContain('stranger@example.test');
  });

  it('never lets the password out when nodemailer refuses a URL', () => {
    // The schema refuses this one first; this is what still holds if the two ever differ again.
    const env = { ...parseEnv(ENV), SMTP_URL: 'smtps://box:hidden@ho%2Fst:465' };
    let thrown: unknown;
    try {
      emailSenderFor(env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(new Error('SMTP_URL not usable'));
    expect(inspect(thrown)).not.toContain('hidden');
  });
});

describe('smtpOptionsOf', () => {
  it('gives nodemailer the address and the password as the menu encoded them', () => {
    const address = 'box@example.test';
    const everySpecialCharacter = 'a$b#c%d@e:f/g?h&i\'j"k l+m=n!o(p)q*r~s';
    const login = [address, everySpecialCharacter].map((part) => encodeURIComponent(part));
    const url = `smtps://${login.join(':')}@smtp.example.test:465`;
    const { options } = createTransport(smtpOptionsOf(url)) as unknown as {
      options: {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
      };
    };
    expect(options).toMatchObject({ host: 'smtp.example.test', port: 465, secure: true });
    expect(options.auth.user).toBe(address);
    expect(options.auth.pass).toBe(everySpecialCharacter);
  });

  it('never leaves a stalled mail server minutes to answer', () => {
    const { options } = createTransport(
      smtpOptionsOf('smtps://smtp.example.test:465'),
    ) as unknown as {
      options: { connectionTimeout: number; greetingTimeout: number; socketTimeout: number };
    };
    expect(options.connectionTimeout).toBeLessThanOrEqual(10_000);
    expect(options.greetingTimeout).toBeLessThanOrEqual(10_000);
    expect(options.socketTimeout).toBeLessThanOrEqual(30_000);
  });
});
