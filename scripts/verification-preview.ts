import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import type { Environment } from '../src/core/config/environment';
import { AuthConfig } from '../src/core/config/auth-config.service';
import { databaseOptions } from '../src/core/database/database.options';
import { MailOutboxEntity } from '../src/features/notifications/entities/mail-outbox.entity';
import { EncryptedVerificationMessage } from '../src/features/notifications/verification-message.factory';

async function main(): Promise<void> {
  const { environment, database } = loadCliConfig();
  if (environment.NODE_ENV === 'production')
    throw new Error('Local preview is disabled in production');
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Supply an email address');
  const source = await new DataSource(databaseOptions(database)).initialize();
  try {
    const mail = await source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where('mail.recipient = :email', { email })
      .andWhere("mail.template = 'verify_email'")
      .orderBy('mail.createdAt', 'DESC')
      .getOne();
    if (!mail) throw new Error('No verification message is queued');
    const codec = new EncryptedVerificationMessage(
      new AuthConfig(new ConfigService<Environment, true>(environment)),
    );
    const payload = codec.open(mail.recipient, mail.keyId, mail.payloadCiphertext);
    mkdirSync('.local', { recursive: true });
    const file = join('.local', 'verification-preview.json');
    writeFileSync(file, JSON.stringify({ email, token: payload.token }), { mode: 0o600 });
    console.log(
      'Private verification request written to .local/verification-preview.json. Treat it as a credential; delete after use.',
    );
  } finally {
    await source.destroy();
  }
}
void main().catch(() => {
  console.error(
    'Verification preview failed; check development mode, configured keys and queued email.',
  );
  process.exitCode = 1;
});
