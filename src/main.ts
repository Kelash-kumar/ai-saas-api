import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { RuntimeConfig } from './core/config/runtime-config.service';
import { AppLogger } from './core/logging/app-logger.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  setupApp(app);
  const config = app.get(RuntimeConfig);
  await app.listen(config.app.port, config.app.host);
  app.get(AppLogger).info('Application started');
}

void bootstrap().catch(() => {
  // Startup can fail before logger DI exists. Never print raw config or credentials.
  console.error('Application startup failed; check configuration and infrastructure.');
  process.exitCode = 1;
});
