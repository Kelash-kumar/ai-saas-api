import { Global, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { DatabaseConfig } from '../config/database-config.service';
import { databaseOptions } from './database.options';
import { UnitOfWork } from './unit-of-work';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(private readonly source: DataSource) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }
}

@Global()
@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: DataSource,
      inject: [DatabaseConfig],
      useFactory: async (config: DatabaseConfig) => {
        try {
          return await new DataSource(databaseOptions(config)).initialize();
        } catch {
          throw new Error(
            'Database initialization failed; check database configuration and availability',
          );
        }
      },
    },
    DatabaseLifecycle,
    UnitOfWork,
  ],
  exports: [DataSource, UnitOfWork],
})
export class DatabaseModule {}
