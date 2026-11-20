import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiSuccess } from '../../../common/http/api-success.decorator';
import { Authenticated } from '../../authorization/decorators/access.decorators';
import { CurrentUser, Public } from '../decorators/auth.decorators';
import { EmailDto, MessageDto, VerificationDto } from '../dto/auth.dto';
import { ChangePasswordDto, CurrentPasswordDto, ResetPasswordDto } from '../dto/recovery.dto';
import { AuthOriginGuard } from '../guards/origin.guard';
import type { Principal } from '../interfaces/auth.types';
import { PasswordRecoveryService } from '../services/password-recovery.service';
import { AccountLifecycleService } from '../services/account-lifecycle.service';
import { SessionCookies } from '../transport/session-cookies';

const generic = { message: 'If this account is eligible, instructions are queued.' };

@ApiTags('account recovery')
@Controller({ path: 'auth', version: '1' })
@Authenticated()
@UseGuards(AuthOriginGuard)
@ApiHeader({ name: 'Origin', required: true })
export class RecoveryController {
  constructor(
    private readonly passwords: PasswordRecoveryService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly cookies: SessionCookies,
  ) {}
  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiSuccess(MessageDto, 202)
  async forgot(@Body() input: EmailDto) {
    await this.passwords.forgot(input.email);
    return generic;
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async reset(@Body() input: ResetPasswordDto, @Res({ passthrough: true }) response: Response) {
    await this.passwords.reset(input.token, input.newPassword);
    this.cookies.clear(response);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async change(
    @CurrentUser() principal: Principal,
    @Body() input: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.passwords.change(principal, input.currentPassword, input.newPassword);
    this.cookies.clear(response);
  }

  @Post('deactivate')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async deactivate(
    @CurrentUser() principal: Principal,
    @Body() input: CurrentPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.lifecycle.deactivate(principal, input.currentPassword);
    this.cookies.clear(response);
  }

  @Post('activation/request')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiSuccess(MessageDto, 202)
  async requestActivation(@Body() input: EmailDto) {
    await this.lifecycle.requestActivation(input.email);
    return generic;
  }

  @Post('activate')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  activate(@Body() input: VerificationDto) {
    return this.lifecycle.activate(input.token);
  }
}
