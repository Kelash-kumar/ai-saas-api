import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from 'nestjs-pino';
import { MailWorkerModule } from './features/notifications/mail-worker.module';
import { OutboxWorker } from './features/notifications/outbox.worker';
import { MailConfig } from './core/config/mail-config.service';
import { AppLogger } from './core/logging/app-logger.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MailWorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const worker = app.get(OutboxWorker);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const once = process.argv.includes('--once');
  try {
    do {
      try {
        await worker.processOnce();
      } catch (error) {
        app.get(AppLogger).unexpected(error);
        if (once) throw new Error('Worker iteration failed');
      }
      if (once) break;
      await delay(app.get(MailConfig).settings.pollMs, undefined, { signal: abort.signal }).catch(
        () => undefined,
      );
    } while (!abort.signal.aborted);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await app.close();
  }
}
void main().catch(() => {
  console.error('Mail worker failed; inspect safe operational diagnostics.');
  process.exitCode = 1;
});
