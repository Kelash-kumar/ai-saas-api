import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RuntimeConfig } from '../../core/config/runtime-config.service';
import { RuntimeConfigModule } from '../../core/config/runtime-config.module';
import { HealthController } from './health.controller';
import { LifecycleService } from './lifecycle.service';
import { DatabaseHealthIndicator } from './database-health.indicator';

@Module({
  imports: [
    TerminusModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [RuntimeConfig],
      useFactory: (config: RuntimeConfig) => ({
        gracefulShutdownTimeoutMs: config.app.shutdownTimeoutMs,
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [LifecycleService, DatabaseHealthIndicator],
})
export class HealthModule {}
