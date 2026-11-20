import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateEnvironment } from '../../core/config/environment';
import type { Environment } from '../../core/config/environment';
import { MailConfig } from '../../core/config/mail-config.service';
import { testAuthSettings } from '../../../test/support/auth-settings';
import { MailRenderer } from './mail.renderer';
import { FileMailTransport } from './transports/file-mail.transport';

const config = () =>
  new MailConfig(
    new ConfigService<Environment, true>(
      validateEnvironment({
        DATABASE_PASSWORD: 'unit-test-password',
        ...testAuthSettings,
        MAIL_PUBLIC_URL: 'https://app.example.com/account',
      }),
    ),
  );
describe('Mail rendering and private capture', () => {
  it('uses a trusted configured base and fragment-bound tokens without request Host input', () => {
    const renderer = new MailRenderer(config());
    const message = renderer.render(randomUUID(), 'password_reset', 'ada@example.com', {
      token: 'A'.repeat(43),
    });
    expect(message.text).toContain('https://app.example.com/account/reset-password#token=');
    expect(message.text).not.toContain('?token=');
    expect(() => renderer.render(randomUUID(), 'unknown', 'ada@example.com', {})).toThrow(
      'INVALID_PAYLOAD',
    );
    expect(() =>
      renderer.render(randomUUID(), 'password_reset', 'ada@example.com\r\nBcc: evil@example.com', {
        token: 'x',
      }),
    ).toThrow();
  });
  it('atomically captures a private local message using a stable job ID', async () => {
    const settings = config();
    const id = randomUUID();
    const message = new MailRenderer(settings).render(
      id,
      'password_changed',
      'ada@example.com',
      {},
    );
    const transport = new FileMailTransport(settings);
    const file = join(process.cwd(), '.local', 'mail', `${id}.eml`);
    try {
      await transport.send(message);
      await transport.send(message);
      const content = await readFile(file, 'utf8');
      expect(content).toContain(`Message-ID: <${id}@auth-foundation.invalid>`);
      expect(content).toContain('Your password changed');
      await expect(transport.send({ ...message, id: '../outside' })).rejects.toThrow(
        'INVALID_PAYLOAD',
      );
    } finally {
      await rm(file, { force: true });
    }
  });
});
