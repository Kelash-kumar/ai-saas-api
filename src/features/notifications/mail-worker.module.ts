import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../../core/config/runtime-config.module';
import { DatabaseModule } from '../../core/database/database.module';
import { LoggingModule } from '../../core/logging/logging.module';
import { MailConfig } from '../../core/config/mail-config.service';
import { NotificationsModule } from './notifications.module';
import { MAIL_TRANSPORT } from './interfaces/mail.types';
import { FileMailTransport } from './transports/file-mail.transport';
import { SmtpMailTransport } from './transports/smtp-mail.transport';
import { MailRenderer } from './mail.renderer';
import { OutboxRepository } from './repositories/outbox.repository';
import { OutboxWorker } from './outbox.worker';

@Module({
  imports: [RuntimeConfigModule, DatabaseModule, LoggingModule, NotificationsModule],
  providers: [
    MailRenderer,
    OutboxRepository,
    OutboxWorker,
    {
      provide: MAIL_TRANSPORT,
      inject: [MailConfig],
      useFactory: (config: MailConfig) =>
        config.settings.transport === 'smtp'
          ? new SmtpMailTransport(config)
          : new FileMailTransport(config),
    },
  ],
})
export class MailWorkerModule {}
