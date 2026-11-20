import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiExceptionFilter } from '../common/errors/api-exception.filter';
import { ResponseInterceptor } from '../common/http/response.interceptor';
import { RuntimeConfig } from './config/runtime-config.service';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { LoggingModule } from './logging/logging.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    RuntimeConfigModule,
    LoggingModule,
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [RuntimeConfig],
      useFactory: (config: RuntimeConfig) => [
        {
          ttl: config.security.rateLimitTtlMs,
          limit: config.security.rateLimitMax,
        },
      ],
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class CoreModule {}
