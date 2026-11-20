import { ConfigService } from '@nestjs/config';
import { SMTPServer } from 'smtp-server';
import { randomUUID } from 'node:crypto';
import { DatabaseHarness } from './database-harness';
import { validateEnvironment } from '../../src/core/config/environment';
import type { Environment } from '../../src/core/config/environment';
import { AuthConfig } from '../../src/core/config/auth-config.service';
import { MailConfig } from '../../src/core/config/mail-config.service';
import { testAuthSettings } from '../support/auth-settings';
import { EncryptedMessages } from '../../src/features/notifications/encrypted-messages';
import { OutboxRepository } from '../../src/features/notifications/repositories/outbox.repository';
import { OutboxWorker } from '../../src/features/notifications/outbox.worker';
import { MailRenderer } from '../../src/features/notifications/mail.renderer';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { DeliveryError } from '../../src/features/notifications/interfaces/mail.types';
import type {
  MailTransport,
  MailTemplate,
} from '../../src/features/notifications/interfaces/mail.types';
import { SmtpMailTransport } from '../../src/features/notifications/transports/smtp-mail.transport';
import type { AppLogger } from '../../src/core/logging/app-logger.service';

function settings(extra: Record<string, unknown> = {}) {
  return new ConfigService<Environment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_PASSWORD: 'unit-test-password',
      ...testAuthSettings,
      MAIL_MAX_ATTEMPTS: 2,
      MAIL_TIMEOUT_MS: 500,
      MAIL_LEASE_MS: 15000,
      MAIL_PUBLIC_URL: 'https://app.example.com',
      ...extra,
    }),
  );
}

describe('Durable outbox worker', () => {
  let db: DatabaseHarness;
  const configuration = settings();
  const config = new MailConfig(configuration);
  const codec = new EncryptedMessages(new AuthConfig(configuration));
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as AppLogger;
  let repository: OutboxRepository;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
    repository = new OutboxRepository(db.source, config);
  });
  beforeEach(async () => {
    await db.reset();
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  const queue = (template: MailTemplate = 'password_changed', token?: string) =>
    db.source
      .getRepository(MailOutboxEntity)
      .save(codec.prepare(template, 'ada@example.com', token));
  const worker = (transport: MailTransport, customConfig = config) =>
    new OutboxWorker(
      new OutboxRepository(db.source, customConfig),
      codec,
      new MailRenderer(customConfig),
      transport,
      logger,
    );

  it('claims distinct work across workers and acknowledges accepted messages', async () => {
    await queue();
    await queue();
    const send = jest.fn().mockResolvedValue(undefined);
    expect(
      await Promise.all([worker({ send }).processOnce(), worker({ send }).processOnce()]),
    ).toEqual([true, true]);
    expect(send).toHaveBeenCalledTimes(2);
    const delivered = await db.source.getRepository(MailOutboxEntity).find();
    expect(
      delivered.every((row) => row.processedAt && row.leaseId === null && row.attempts === 1),
    ).toBe(true);
    const ids = send.mock.calls.map((args: unknown[]) => (args[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('skips locked rows instead of blocking another worker', async () => {
    const mail = await queue();
    const runner = db.source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT id FROM mail_outbox WHERE id=$1 FOR UPDATE', [mail.id]);
      expect(await repository.claim()).toBeNull();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('recovers expired leases and fences stale acknowledgements', async () => {
    const mail = await queue();
    const first = await repository.claim();
    if (!first) throw new Error('Missing first claim');
    await db.source.query(
      "UPDATE mail_outbox SET leased_until=now()-interval '1 second' WHERE id=$1",
      [mail.id],
    );
    const second = await repository.claim();
    if (!second) throw new Error('Missing recovered claim');
    expect(second.leaseId).not.toBe(first.leaseId);
    expect(await repository.ownsLease(first)).toBe(false);
    await repository.complete(first);
    expect(
      (await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id }))
        .processedAt,
    ).toBeNull();
    await repository.complete(second);
    expect(
      (await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id }))
        .processedAt,
    ).not.toBeNull();
  });

  it('records transient retry/backoff without driver secrets, then stops at the attempt limit', async () => {
    const mail = await queue();
    const transport = { send: jest.fn().mockRejectedValue(new Error('PRIVATE_PASSWORD_AND_BODY')) };
    await worker(transport).processOnce();
    let row = await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id });
    expect(row).toMatchObject({
      attempts: 1,
      deadAt: null,
      lastErrorCode: 'PROCESSING_TRANSIENT',
      leaseId: null,
    });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await repository.claim()).toBeNull();
    await db.source.query('UPDATE mail_outbox SET available_at=now() WHERE id=$1', [mail.id]);
    await worker(transport).processOnce();
    row = await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id });
    expect(row.deadAt).not.toBeNull();
    expect(row.attempts).toBe(2);
    expect(JSON.stringify(row)).not.toContain('PRIVATE');
    expect(await repository.claim()).toBeNull();
  });

  it('dead-letters permanently rejected or corrupted messages without retries', async () => {
    const mail = await queue();
    await worker({
      send: jest.fn().mockRejectedValue(new DeliveryError('SMTP_PERMANENT', true)),
    }).processOnce();
    expect(
      await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id }),
    ).toMatchObject({ attempts: 1, lastErrorCode: 'SMTP_PERMANENT' });
    await db.reset();
    const corrupt = await queue();
    await db.source
      .getRepository(MailOutboxEntity)
      .update({ id: corrupt.id }, { payloadCiphertext: Buffer.from('corrupted') });
    const send = jest.fn();
    await worker({ send }).processOnce();
    expect(send).not.toHaveBeenCalled();
    expect(
      await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: corrupt.id }),
    ).toMatchObject({ lastErrorCode: 'INVALID_PAYLOAD' });
  });

  it('terminalizes a crashed final attempt and keeps the partial index scoped to live jobs', async () => {
    const mail = await queue();
    await repository.claim();
    await db.source.query(
      "UPDATE mail_outbox SET attempts=2, leased_until=now()-interval '1 second' WHERE id=$1",
      [mail.id],
    );
    expect(await repository.claim()).toBeNull();
    const row = await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id });
    expect(row.deadAt).not.toBeNull();
    expect(row.lastErrorCode).toBe('ATTEMPTS_EXHAUSTED');
    const indices: unknown = await db.source.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname='ix_outbox_pending'",
    );
    expect(JSON.stringify(indices)).toContain('dead_at IS NULL');
  });

  it('skips obsolete token messages and binds encryption to message purpose', async () => {
    const token = 'A'.repeat(43);
    const mail = await queue('password_reset', token);
    const send = jest.fn();
    await worker({ send }).processOnce();
    expect(send).not.toHaveBeenCalled();
    expect(
      (await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id }))
        .lastErrorCode,
    ).toBe('OBSOLETE');
    const prepared = codec.prepare('password_reset', 'ada@example.com', token);
    expect(() =>
      codec.open(
        'account_activation',
        prepared.recipient,
        prepared.keyId,
        prepared.payloadCiphertext,
      ),
    ).toThrow();
  });

  it('delivers through the real SMTP adapter to a local capture server and handles a 550 rejection', async () => {
    const messages: string[] = [];
    let reject = false;
    const server = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      logger: false,
      onRcptTo(_address, _session, callback) {
        callback(reject ? Object.assign(new Error('Rejected'), { responseCode: 550 }) : undefined);
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          messages.push(Buffer.concat(chunks).toString('utf8'));
          callback();
        });
      },
    });
    await new Promise<void>((resolve, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing SMTP port');
      const smtpConfig = new MailConfig(
        settings({
          MAIL_TRANSPORT: 'smtp',
          MAIL_SMTP_HOST: '127.0.0.1',
          MAIL_SMTP_PORT: address.port,
          MAIL_SMTP_REQUIRE_TLS: false,
          MAIL_TIMEOUT_MS: 3000,
          MAIL_LEASE_MS: 30000,
        }),
      );
      const mail = await queue();
      await worker(new SmtpMailTransport(smtpConfig), smtpConfig).processOnce();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(`Message-ID: <${mail.id}@auth-foundation.invalid>`);
      expect(
        (await db.source.getRepository(MailOutboxEntity).findOneByOrFail({ id: mail.id }))
          .processedAt,
      ).not.toBeNull();
      reject = true;
      await expect(
        new SmtpMailTransport(smtpConfig).send({
          id: randomUUID(),
          to: 'ada@example.com',
          subject: 'Test',
          text: 'Private test body',
        }),
      ).rejects.toMatchObject({ code: 'SMTP_PERMANENT', permanent: true });
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it('bounds a stalled SMTP delivery and exposes only a safe transient failure', async () => {
    const server = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      logger: false,
      onData(stream) {
        stream.resume();
      },
    });
    await new Promise<void>((resolve, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing SMTP port');
      const smtpConfig = new MailConfig(
        settings({
          MAIL_TRANSPORT: 'smtp',
          MAIL_SMTP_HOST: '127.0.0.1',
          MAIL_SMTP_PORT: address.port,
          MAIL_SMTP_REQUIRE_TLS: false,
          MAIL_TIMEOUT_MS: 500,
        }),
      );
      await expect(
        new SmtpMailTransport(smtpConfig).send({
          id: randomUUID(),
          to: 'ada@example.com',
          subject: 'Test',
          text: 'Private body',
        }),
      ).rejects.toMatchObject({ permanent: false });
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
});
