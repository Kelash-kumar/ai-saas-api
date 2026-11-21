import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ArgonPasswordHasher } from './crypto/argon-password-hasher';
import { AccessTokenService } from './crypto/access-token.service';
import { PASSWORD_HASHER } from './interfaces/auth.types';
import { NotificationsModule } from '../notifications/notifications.module';
import { RegistrationService } from './services/registration.service';
import { SessionAuthService } from './services/session-auth.service';
import { SessionCookies } from './transport/session-cookies';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthenticationGuard } from './guards/jwt-authentication.guard';
import { LocalAuthenticationGuard } from './guards/local-authentication.guard';
import { AuthOriginGuard } from './guards/origin.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { AuthController } from './controllers/auth.controller';
import { RecoveryController } from './controllers/recovery.controller';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { PasswordConfirmation } from './services/password-confirmation.service';
import { AccountLifecycleService } from './services/account-lifecycle.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AccessPipelineGuard } from './guards/access-pipeline.guard';

@Module({
  imports: [JwtModule.register({}), NotificationsModule, AuthorizationModule],
  controllers: [AuthController, RecoveryController],
  exports: [RegistrationService, PASSWORD_HASHER],
  providers: [
    ArgonPasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: ArgonPasswordHasher },
    PasswordRecoveryService,
    PasswordConfirmation,
    AccountLifecycleService,
    AccessTokenService,
    RegistrationService,
    SessionAuthService,
    SessionCookies,
    LocalStrategy,
    JwtStrategy,
    LocalAuthenticationGuard,
    AuthOriginGuard,
    CsrfGuard,
    JwtAuthenticationGuard,
    { provide: APP_GUARD, useClass: AccessPipelineGuard },
  ],
})
export class AuthModule {}
