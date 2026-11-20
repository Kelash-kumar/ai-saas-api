import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SessionsRepository } from './repositories/sessions.repository';

@Module({
  providers: [
    {
      provide: SessionsRepository,
      inject: [DataSource],
      useFactory: (source: DataSource) => new SessionsRepository(source.manager),
    },
  ],
  exports: [SessionsRepository],
})
export class SessionsModule {}
