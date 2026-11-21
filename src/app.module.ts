import { Module } from '@nestjs/common';
import { ManagementModule } from './features/management.module';
import { CoreModule } from './core/core.module';
import { HealthModule } from './features/health/health.module';
import { UsersModule } from './features/users/users.module';
import { AuthorizationModule } from './features/authorization/authorization.module';
import { SessionsModule } from './features/sessions/sessions.module';
import { AuthModule } from './features/auth/auth.module';

@Module({
  imports: [
    CoreModule,
    HealthModule,
    UsersModule,
    AuthorizationModule,
    SessionsModule,
    AuthModule,
    ManagementModule,
  ],
})
export class AppModule {}
