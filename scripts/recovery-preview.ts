import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/core/config/environment';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import { AuthConfig } from '../src/core/config/auth-config.service';
import { databaseOptions } from '../src/core/database/database.options';
import { MailOutboxEntity } from '../src/features/notifications/entities/mail-outbox.entity';
import { EncryptedMessages } from '../src/features/notifications/encrypted-messages';

async function main(): Promise<void> {
  const { environment, database } = loadCliConfig();
  if (environment.NODE_ENV === 'production') throw new Error('Local preview disabled');
  const email = process.argv[2]?.trim().toLowerCase();
  const template = process.argv[3];
  if (!email || !['password_reset', 'account_activation'].includes(template ?? ''))
    throw new Error('Email and recovery purpose required');
  const source = await new DataSource(databaseOptions(database)).initialize();
  try {
    const mail = await source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where('mail.recipient = :email AND mail.template = :template', { email, template })
      .orderBy('mail.createdAt', 'DESC')
      .getOneOrFail();
    const codec = new EncryptedMessages(
      new AuthConfig(new ConfigService<Environment, true>(environment)),
    );
    const payload = codec.open(mail.template, mail.recipient, mail.keyId, mail.payloadCiphertext);
    mkdirSync('.local', { recursive: true });
    writeFileSync(
      '.local/recovery-preview.json',
      JSON.stringify({ email, purpose: template, token: payload.token }),
      { mode: 0o600 },
    );
    console.log('Private request written to .local/recovery-preview.json; delete after use.');
  } finally {
    await source.destroy();
  }
}
void main().catch(() => {
  console.error('Recovery preview failed; check development mode, purpose and queued message.');
  process.exitCode = 1;
});
