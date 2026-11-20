import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { USERS_REPOSITORY } from './interfaces/users-repository.interface';
import { TypeormUsersRepository } from './repositories/typeorm-users.repository';

@Module({
  providers: [
    {
      provide: USERS_REPOSITORY,
      inject: [DataSource],
      useFactory: (source: DataSource) => new TypeormUsersRepository(source.manager),
    },
  ],
  exports: [USERS_REPOSITORY],
})
export class UsersModule {}
