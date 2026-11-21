import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { RawResponse } from '../../../common/http/response.decorator';
import { ApiSuccess } from '../../../common/http/api-success.decorator';
import { CurrentUser } from '../../auth/decorators/auth.decorators';
import type { Principal } from '../../auth/interfaces/auth.types';
import { AuthOriginGuard } from '../../auth/guards/origin.guard';
import { Authenticated, Permissions } from '../decorators/access.decorators';
import { AuthorizationService } from '../services/authorization.service';
import { AdministrationService } from '../services/administration.service';
import {
  AuthorityDto,
  UserAuthorityDto,
  CreatePermissionDto,
  CreateRoleDto,
  RoleDescriptionDto,
  UserStatusDto,
  RoleViewDto,
  RoleDetailsDto,
  PermissionViewDto,
  RolePageDto,
  PermissionPageDto,
  ManagedUserPageDto,
} from '../dto/management.dto';

const uuid = () => new ParseUUIDPipe();
@ApiTags('authorization management')
@ApiBearerAuth()
@ApiHeader({
  name: 'Origin',
  required: false,
  description: 'Required for unsafe management requests.',
})
@Controller({ path: 'authorization', version: '1' })
@UseGuards(AuthOriginGuard)
export class AuthorizationController {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly administration: AdministrationService,
  ) {}
  @Get('me')
  @Authenticated()
  @ApiSuccess(AuthorityDto)
  me(@CurrentUser() principal: Principal) {
    return this.authorization.authority(principal.userId);
  }

  @Get('roles')
  @ApiResponse({ status: 200, type: RolePageDto })
  @Permissions('roles.read')
  @RawResponse()
  roles(@Query() query: PageQueryDto) {
    return this.authorization.roles(query);
  }
  @Get('roles/:roleId')
  @ApiSuccess(RoleDetailsDto)
  @Permissions('roles.read')
  role(@Param('roleId', uuid()) roleId: string) {
    return this.authorization.role(roleId);
  }
  @Post('roles')
  @ApiSuccess(RoleViewDto, 201)
  @Permissions('roles.create', 'roles.delegate')
  createRole(@CurrentUser() principal: Principal, @Body() body: CreateRoleDto) {
    return this.authorization.createRole(principal, body.name, body.description);
  }
  @Patch('roles/:roleId')
  @ApiSuccess(RoleViewDto)
  @Permissions('roles.update')
  updateRole(
    @CurrentUser() principal: Principal,
    @Param('roleId', uuid()) roleId: string,
    @Body() body: RoleDescriptionDto,
  ) {
    return this.authorization.updateRole(principal, roleId, body.description);
  }
  @Delete('roles/:roleId')
  @Permissions('roles.delete')
  @HttpCode(204)
  deleteRole(@CurrentUser() principal: Principal, @Param('roleId', uuid()) roleId: string) {
    return this.authorization.deleteRole(principal, roleId);
  }

  @Get('permissions')
  @ApiResponse({ status: 200, type: PermissionPageDto })
  @Permissions('permissions.read')
  @RawResponse()
  permissions(@Query() query: PageQueryDto) {
    return this.authorization.permissions(query);
  }
  @Post('permissions')
  @ApiSuccess(PermissionViewDto, 201)
  @Permissions('permissions.create')
  createPermission(@CurrentUser() principal: Principal, @Body() body: CreatePermissionDto) {
    return this.authorization.createPermission(principal, body.resource, body.action);
  }

  @Post('roles/:roleId/permissions/:permissionId')
  @Permissions('permissions.assign')
  @HttpCode(204)
  grantRolePermission(
    @CurrentUser() actor: Principal,
    @Param('roleId', uuid()) roleId: string,
    @Param('permissionId', uuid()) permissionId: string,
  ) {
    return this.authorization.rolePermission(actor, roleId, permissionId, true);
  }
  @Delete('roles/:roleId/permissions/:permissionId')
  @Permissions('permissions.revoke')
  @HttpCode(204)
  revokeRolePermission(
    @CurrentUser() actor: Principal,
    @Param('roleId', uuid()) roleId: string,
    @Param('permissionId', uuid()) permissionId: string,
  ) {
    return this.authorization.rolePermission(actor, roleId, permissionId, false);
  }
  @Post('roles/:roleId/inherits/:inheritedRoleId')
  @Permissions('roles.update')
  @HttpCode(204)
  inherit(
    @CurrentUser() actor: Principal,
    @Param('roleId', uuid()) roleId: string,
    @Param('inheritedRoleId', uuid()) inheritedRoleId: string,
  ) {
    return this.authorization.inheritance(actor, roleId, inheritedRoleId, true);
  }
  @Delete('roles/:roleId/inherits/:inheritedRoleId')
  @Permissions('roles.update')
  @HttpCode(204)
  uninherit(
    @CurrentUser() actor: Principal,
    @Param('roleId', uuid()) roleId: string,
    @Param('inheritedRoleId', uuid()) inheritedRoleId: string,
  ) {
    return this.authorization.inheritance(actor, roleId, inheritedRoleId, false);
  }

  @Get('users')
  @ApiResponse({ status: 200, type: ManagedUserPageDto })
  @Permissions('users.read')
  @RawResponse()
  users(@Query() query: PageQueryDto) {
    return this.authorization.users(query);
  }
  @Get('users/:userId/authority')
  @Permissions('users.read')
  @ApiSuccess(UserAuthorityDto)
  userAuthority(@Param('userId', uuid()) userId: string) {
    return this.authorization.userAuthority(userId);
  }
  @Post('users/:userId/roles/:roleId')
  @Permissions('roles.assign')
  @HttpCode(204)
  grantMembership(
    @CurrentUser() actor: Principal,
    @Param('userId', uuid()) userId: string,
    @Param('roleId', uuid()) roleId: string,
  ) {
    return this.authorization.membership(actor, userId, roleId, true);
  }
  @Delete('users/:userId/roles/:roleId')
  @Permissions('roles.assign')
  @HttpCode(204)
  revokeMembership(
    @CurrentUser() actor: Principal,
    @Param('userId', uuid()) userId: string,
    @Param('roleId', uuid()) roleId: string,
  ) {
    return this.authorization.membership(actor, userId, roleId, false);
  }
  @Post('users/:userId/permissions/:permissionId')
  @Permissions('permissions.assign')
  @HttpCode(204)
  grantDirect(
    @CurrentUser() actor: Principal,
    @Param('userId', uuid()) userId: string,
    @Param('permissionId', uuid()) permissionId: string,
  ) {
    return this.authorization.directPermission(actor, userId, permissionId, true);
  }
  @Delete('users/:userId/permissions/:permissionId')
  @Permissions('permissions.revoke')
  @HttpCode(204)
  revokeDirect(
    @CurrentUser() actor: Principal,
    @Param('userId', uuid()) userId: string,
    @Param('permissionId', uuid()) permissionId: string,
  ) {
    return this.authorization.directPermission(actor, userId, permissionId, false);
  }
  @Patch('users/:userId/status')
  @Permissions('users.update_status')
  @HttpCode(204)
  status(
    @CurrentUser() actor: Principal,
    @Param('userId', uuid()) userId: string,
    @Body() body: UserStatusDto,
  ) {
    return this.administration.status(actor, userId, body.status);
  }
  @Post('users/:userId/unlock')
  @Permissions('users.unlock')
  @HttpCode(204)
  unlock(@CurrentUser() actor: Principal, @Param('userId', uuid()) userId: string) {
    return this.administration.unlock(actor, userId);
  }
}
