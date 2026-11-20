import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuthConfig } from '../../core/config/auth-config.service';
import { validOpaqueToken } from '../auth/crypto/opaque-token';
import { mailTemplates } from './interfaces/mail.types';
import type { MailPayload, MailTemplate, SecurityMessages } from './interfaces/mail.types';

@Injectable()
export class EncryptedMessages implements SecurityMessages {
  constructor(private readonly config: AuthConfig) {}
  prepare(template: MailTemplate, recipient: string, token?: string) {
    const keyId = this.config.settings.outboxKeyId;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.settings.outboxKey, nonce);
    cipher.setAAD(Buffer.from(`${keyId}:${template}:${recipient}`));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(token ? { token } : {}), 'utf8'),
      cipher.final(),
    ]);
    return {
      recipient,
      template,
      keyId,
      payloadCiphertext: Buffer.concat([nonce, cipher.getAuthTag(), data]),
    };
  }

  open(template: string, recipient: string, keyId: string, ciphertext: Buffer): MailPayload {
    if (
      !mailTemplates.some((value) => value === template) ||
      keyId !== this.config.settings.outboxKeyId ||
      ciphertext.length < 29
    )
      throw new Error('Invalid encrypted message');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.config.settings.outboxKey,
      ciphertext.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(`${keyId}:${template}:${recipient}`));
    decipher.setAuthTag(ciphertext.subarray(12, 28));
    const payload: unknown = JSON.parse(
      Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]).toString('utf8'),
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('Invalid message');
    const token = 'token' in payload ? payload.token : undefined;
    if (
      ['verify_email', 'password_reset', 'account_activation'].includes(template) &&
      !validOpaqueToken(token)
    )
      throw new Error('Invalid message token');
    return validOpaqueToken(token) ? { token } : {};
  }
}
