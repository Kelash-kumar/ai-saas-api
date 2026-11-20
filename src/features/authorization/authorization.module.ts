import { Module } from '@nestjs/common';
import { AuthorizationController } from './controllers/authorization.controller';
import { AuthorizationService } from './services/authorization.service';
import { AdministrationService } from './services/administration.service';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { AuthOriginGuard } from '../auth/guards/origin.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthorizationController],
  providers: [
    AuthorizationService,
    AdministrationService,
    RolesGuard,
    PermissionsGuard,
    AuthOriginGuard,
  ],
  exports: [AuthorizationService, RolesGuard, PermissionsGuard],
})
export class AuthorizationModule {}
