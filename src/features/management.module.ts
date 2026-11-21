import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CompaniesService } from './companies/companies.service';
import { CompaniesController } from './companies/companies.controller';
import { UserManagementService } from './users/user-management.service';
import { UserManagementController } from './users/user-management.controller';
import { CrmService } from './crm/crm.service';
import { CrmController } from './crm/crm.controller';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [CompaniesController, UserManagementController, CrmController],
  providers: [CompaniesService, UserManagementService, CrmService],
})
export class ManagementModule {}
