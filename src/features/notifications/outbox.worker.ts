import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EncryptedMessages } from './encrypted-messages';
import { MailRenderer } from './mail.renderer';
import { OutboxRepository } from './repositories/outbox.repository';
import { MAIL_TRANSPORT, DeliveryError } from './interfaces/mail.types';
import type { MailTransport, MailPayload } from './interfaces/mail.types';
import { tokenDigest } from '../auth/crypto/opaque-token';
import { AppLogger } from '../../core/logging/app-logger.service';

@Injectable()
export class OutboxWorker {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly codec: EncryptedMessages,
    private readonly renderer: MailRenderer,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly logger: AppLogger,
  ) {}
  async processOnce(): Promise<boolean> {
    const mail = await this.repository.claim();
    if (!mail) return false;
    try {
      let payload: MailPayload;
      try {
        payload = this.codec.open(
          mail.template,
          mail.recipient,
          mail.keyId,
          mail.payloadCiphertext,
        );
      } catch {
        throw new DeliveryError('INVALID_PAYLOAD', true);
      }
      if (
        payload.token &&
        !(await this.repository.tokenIsCurrent(
          mail.template,
          mail.recipient,
          tokenDigest(payload.token),
        ))
      ) {
        await this.repository.complete(mail, 'OBSOLETE');
        return true;
      }
      const message = this.renderer.render(mail.id, mail.template, mail.recipient, payload);
      if (!(await this.repository.ownsLease(mail))) return true;
      await this.transport.send(message);
    } catch (error) {
      const failure =
        error instanceof DeliveryError ? error : new DeliveryError('PROCESSING_TRANSIENT', false);
      const delay = Math.min(3600000, 1000 * 2 ** (mail.attempts - 1));
      await this.repository.failed(
        mail,
        failure.code,
        failure.permanent,
        delay + randomInt(Math.max(1, Math.floor(delay / 5))),
      );
      this.logger.warn('Outbox delivery failed; retry or terminal state recorded');
      return true;
    }
    // Acknowledgement failures propagate: a crash after provider acceptance may cause a duplicate on retry.
    await this.repository.complete(mail);
    this.logger.info('Outbox delivery accepted by configured transport');
    return true;
  }
}
