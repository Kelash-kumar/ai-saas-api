import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { RuntimeConfig } from '../../src/core/config/runtime-config.service';
import type { Environment } from '../../src/core/config/environment';
import { validateEnvironment } from '../../src/core/config/environment';
import { AppLogger } from '../../src/core/logging/app-logger.service';
import { setupApp } from '../../src/setup-app';
import { DataSource } from 'typeorm';
import { testAuthSettings } from './auth-settings';
import { AuthConfig } from '../../src/core/config/auth-config.service';
import { MailConfig } from '../../src/core/config/mail-config.service';

export async function createTestApplication(
  controllers: Type[] = [],
  settings: Record<string, unknown> = {},
  dataSource?: DataSource,
): Promise<NestExpressApplication> {
  const validated = new ConfigService<Environment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SWAGGER_ENABLED: false,
      CORS_ORIGINS: 'https://app.example.com',
      RATE_LIMIT_MAX: 1000,
      DATABASE_PASSWORD: 'unit-test-password',
      ...testAuthSettings,
      ...settings,
    }),
  );
  const config = new RuntimeConfig(validated);
  const module = await Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(DataSource)
    .useValue(
      dataSource ?? {
        isInitialized: true,
        query: jest.fn().mockResolvedValue([]),
        destroy: jest.fn(),
        manager: {},
      },
    )
    .overrideProvider(RuntimeConfig)
    .useValue(config)
    .overrideProvider(AuthConfig)
    .useValue(new AuthConfig(validated))
    .overrideProvider(MailConfig)
    .useValue(new MailConfig(validated))
    .overrideProvider(AppLogger)
    .useValue({ unexpected: jest.fn(), security: jest.fn(), info: jest.fn(), warn: jest.fn() })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.init();
  return app;
}
