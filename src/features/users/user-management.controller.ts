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
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiSuccess } from '../../common/http/api-success.decorator';
import { RawResponse } from '../../common/http/response.decorator';
import { CurrentUser } from '../auth/decorators/auth.decorators';
import type { Principal } from '../auth/interfaces/auth.types';
import { AuthOriginGuard } from '../auth/guards/origin.guard';
import { Permissions } from '../authorization/decorators/access.decorators';
import { UserManagementService } from './user-management.service';
import {
  CreateManagedUserDto,
  UpdateManagedUserDto,
  UserViewDto,
  UserManagementPageDto,
  UserManagementQueryDto,
} from './dto/user-management.dto';

@ApiTags('users management')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
@UseGuards(AuthOriginGuard)
export class UserManagementController {
  constructor(private readonly service: UserManagementService) {}
  @Get()
  @Permissions('users.read')
  @RawResponse()
  @ApiResponse({ status: 200, type: UserManagementPageDto })
  list(@Query() query: UserManagementQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('users.read')
  @ApiSuccess(UserViewDto)
  find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.find(id);
  }
  @Post()
  @Permissions('users.create')
  @ApiSuccess(UserViewDto, 201)
  create(@CurrentUser() principal: Principal, @Body() data: CreateManagedUserDto) {
    return this.service.create(principal, data);
  }
  @Patch(':id')
  @Permissions('users.update')
  @ApiSuccess(UserViewDto)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateManagedUserDto,
  ) {
    return this.service.update(principal, id, data);
  }
  @Delete(':id')
  @Permissions('users.delete')
  @HttpCode(204)
  @ApiResponse({ status: 204 })
  remove(@CurrentUser() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(principal, id);
  }
}
