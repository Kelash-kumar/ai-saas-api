import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MailConfig } from '../../../core/config/mail-config.service';
import type { Delivery, MailTransport } from '../interfaces/mail.types';
import { DeliveryError } from '../interfaces/mail.types';

/** Private local capture, never a production email provider or application log. */
export class FileMailTransport implements MailTransport {
  constructor(private readonly config: MailConfig) {}
  async send(message: Delivery): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(message.id)) throw new DeliveryError('INVALID_PAYLOAD', true);
    const directory = join(process.cwd(), '.local', 'mail');
    const temporary = join(directory, `${message.id}.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        temporary,
        `From: ${this.config.settings.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nMessage-ID: <${message.id}@auth-foundation.invalid>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}`,
        { mode: 0o600, flag: 'wx' },
      );
      await rename(temporary, join(directory, `${message.id}.eml`));
    } catch {
      throw new DeliveryError('FILE_DELIVERY', false);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
