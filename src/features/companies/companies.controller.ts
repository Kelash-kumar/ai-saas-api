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
import { CompaniesService } from './companies.service';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  CompanyViewDto,
  CompanyPageDto,
} from './dto/company.dto';
import { PageQueryDto } from '../../common/pagination/page-query.dto';
@ApiTags('companies management')
@ApiBearerAuth()
@Controller({ path: 'companies', version: '1' })
@UseGuards(AuthOriginGuard)
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}
  @Get()
  @Permissions('companies.read')
  @RawResponse()
  @ApiResponse({ status: 200, type: CompanyPageDto })
  list(@Query() query: PageQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('companies.read')
  @ApiSuccess(CompanyViewDto)
  find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.find(id);
  }
  @Post()
  @Permissions('companies.create')
  @ApiSuccess(CompanyViewDto, 201)
  create(@CurrentUser() principal: Principal, @Body() data: CreateCompanyDto) {
    return this.service.create(principal, data);
  }
  @Patch(':id')
  @Permissions('companies.update')
  @ApiSuccess(CompanyViewDto)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateCompanyDto,
  ) {
    return this.service.update(principal, id, data);
  }
  @Delete(':id')
  @Permissions('companies.delete')
  @HttpCode(204)
  @ApiResponse({ status: 204 })
  remove(@CurrentUser() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(principal, id);
  }
}
