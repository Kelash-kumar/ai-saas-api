import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';
import { RuntimeConfig } from './core/config/runtime-config.service';
import { createValidationPipe } from './common/http/validation.pipe';

/** Shared by the real server and HTTP tests so validation and security cannot drift. */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get(RuntimeConfig);
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((request: Request, response: Response, next: NextFunction) => {
    request.id = randomUUID();
    response.setHeader('X-Request-Id', request.id);
    if (request.path.startsWith('/api/v1/auth')) response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use(json({ limit: '16kb' }));
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  app.enableCors({
    origin: [...config.security.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  if (config.app.swaggerEnabled) {
    const options = new DocumentBuilder()
      .setTitle('Authentication foundation')
      .setDescription(
        'Phase 5: authentication, recovery, durable mail, dynamic RBAC and scoped administration. Permission changes apply on the next request. Success JSON uses { success, data }; lists use { data, meta }.',
      )
      .setVersion('0.5.0')
      .addBearerAuth()
      .addCookieAuth(
        config.app.environment === 'production'
          ? '__Host-foundation_refresh'
          : 'foundation_refresh',
        { type: 'apiKey', in: 'cookie' },
        'refresh-cookie',
      )
      .build();
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
      swaggerOptions: { persistAuthorization: false },
    });
  }
}
