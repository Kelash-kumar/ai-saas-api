import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CompaniesService } from './companies/companies.service';
import { CompaniesController } from './companies/companies.controller';
import { UserManagementService } from './users/user-management.service';
import { UserManagementController } from './users/user-management.controller';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [CompaniesController, UserManagementController],
  providers: [CompaniesService, UserManagementService],
})
export class ManagementModule {}
