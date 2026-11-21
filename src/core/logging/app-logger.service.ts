import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { safeStack } from './logging.options';

export type SecurityEvent =
  | 'login.challenge'
  | 'login.succeeded'
  | 'login.failed'
  | 'session.revoked'
  | 'access.denied'
  | 'account.registered'
  | 'refresh.rejected'
  | 'password.changed'
  | 'account.deactivated'
  | 'account.activated'
  | 'authorization.changed';

@Injectable()
export class AppLogger {
  constructor(private readonly logger: PinoLogger) {}

  info(message: string): void {
    this.logger.info(message);
  }
  warn(message: string): void {
    this.logger.warn(message);
  }
  debug(message: string): void {
    this.logger.debug(message);
  }
  verbose(message: string): void {
    this.logger.trace(message);
  }

  unexpected(error: unknown, requestId?: string): void {
    this.logger.error(
      {
        requestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? safeStack(error) : undefined,
      },
      'Unhandled application error',
    );
  }

  security(event: SecurityEvent, actorId?: string): void {
    this.logger.info({ event, actorId }, 'Security event');
  }
}
