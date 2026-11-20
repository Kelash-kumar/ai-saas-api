import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { MailConfig } from '../../../core/config/mail-config.service';
import type { Delivery, MailTransport } from '../interfaces/mail.types';
import { DeliveryError } from '../interfaces/mail.types';

export class SmtpMailTransport implements MailTransport {
  constructor(private readonly config: MailConfig) {}
  async send(message: Delivery): Promise<void> {
    const settings = this.config.settings;
    const options: SMTPTransport.Options = {
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.requireTls,
      auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
      connectionTimeout: settings.timeoutMs,
      greetingTimeout: settings.timeoutMs,
      socketTimeout: settings.timeoutMs,
      tls: { rejectUnauthorized: true },
      logger: false,
      debug: false,
    };
    const transport = createTransport(options);
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const messageOptions = {
        from: settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: `<${message.id}@auth-foundation.invalid>`,
        disableFileAccess: true,
        disableUrlAccess: true,
        signal: abort.signal,
      };
      const delivery = transport.sendMail(messageOptions).then((info) => {
        if (!info.accepted.length || info.rejected.length)
          throw new DeliveryError('SMTP_PERMANENT', true);
      });
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          abort.abort();
          reject(new DeliveryError('DELIVERY_TIMEOUT', false));
        }, settings.timeoutMs * 3);
      });
      await Promise.race([delivery, deadline]);
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      if (abort.signal.aborted) throw new DeliveryError('DELIVERY_TIMEOUT', false);
      const status =
        error && typeof error === 'object' && 'responseCode' in error
          ? error.responseCode
          : undefined;
      throw new DeliveryError(
        typeof status === 'number' && status >= 500 ? 'SMTP_PERMANENT' : 'SMTP_TRANSIENT',
        typeof status === 'number' && status >= 500,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      transport.close();
    }
  }
}
