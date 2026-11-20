import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../../common/http/response.decorator';
import { LifecycleService } from './lifecycle.service';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { Public } from '../auth/decorators/auth.decorators';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
@RawResponse()
@SkipThrottle()
@Public()
export class HealthController {
  constructor(
    private readonly checks: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly lifecycle: LifecycleService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Process liveness; no downstream dependencies' })
  live() {
    return this.checks.check([() => this.indicators.check('process').up()]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Application and migrated database readiness' })
  ready() {
    return this.checks.check([
      () => this.database.check(),
      () => {
        const indicator = this.indicators.check('application');
        return this.lifecycle.ready ? indicator.up() : indicator.down();
      },
    ]);
  }
}
