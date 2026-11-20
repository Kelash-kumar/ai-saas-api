import { Injectable } from '@nestjs/common';
import { AuthConfig } from '../../core/config/auth-config.service';
import type { VerificationMessageFactory } from '../auth/interfaces/auth.types';
import { EncryptedMessages } from './encrypted-messages';

/** Keeps phase 3's verification port and encrypted data format compatible. */
@Injectable()
export class EncryptedVerificationMessage implements VerificationMessageFactory {
  private readonly codec: EncryptedMessages;
  constructor(config: AuthConfig) {
    this.codec = new EncryptedMessages(config);
  }
  prepare(email: string, token: string) {
    return this.codec.prepare('verify_email', email, token);
  }
  open(recipient: string, keyId: string, ciphertext: Buffer): { token: string } {
    const value = this.codec.open('verify_email', recipient, keyId, ciphertext);
    if (!value.token) throw new Error('Invalid verification payload');
    return { token: value.token };
  }
}
