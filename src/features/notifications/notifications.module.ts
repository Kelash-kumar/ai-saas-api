import { Module } from '@nestjs/common';
import { VERIFICATION_MESSAGE } from '../auth/interfaces/auth.types';
import { SECURITY_MESSAGES } from './interfaces/mail.types';
import { EncryptedMessages } from './encrypted-messages';
import { EncryptedVerificationMessage } from './verification-message.factory';

@Module({
  providers: [
    EncryptedMessages,
    EncryptedVerificationMessage,
    { provide: SECURITY_MESSAGES, useExisting: EncryptedMessages },
    { provide: VERIFICATION_MESSAGE, useExisting: EncryptedVerificationMessage },
  ],
  exports: [
    EncryptedMessages,
    EncryptedVerificationMessage,
    SECURITY_MESSAGES,
    VERIFICATION_MESSAGE,
  ],
})
export class NotificationsModule {}
