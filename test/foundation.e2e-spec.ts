import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { ApplicationException } from '../src/common/errors/application.exception';
import { RawResponse } from '../src/common/http/response.decorator';
import { PageQueryDto } from '../src/common/pagination/page-query.dto';
import { createPage, resolveSort } from '../src/common/pagination/page';
import { LifecycleService } from '../src/features/health/lifecycle.service';
import { createTestApplication } from './support/test-application';
import { Public } from '../src/features/auth/decorators/auth.decorators';

class InputDto {
  @IsString()
  @MinLength(3)
  name!: string;
}

/** Test-only endpoints exercise shared HTTP infrastructure; never imported by production. */
@Controller({ path: 'fixture', version: '1' })
@Public()
class FixtureController {
  @Post() create(@Body() body: InputDto) {
    return { name: body.name };
  }
  @Get() list(@Query() query: PageQueryDto) {
    resolveSort(query.sortBy, ['id', 'createdAt'], 'id');
    return createPage([], 0, query);
  }
  @Get('error') fail() {
    throw new Error('database password=SECRET');
  }
  @Get('conflict') conflict() {
    throw new ApplicationException(409, 'ACCOUNT_CONFLICT', 'Account conflict');
  }
  @Get('raw') @RawResponse() raw() {
    return { protocol: 'raw' };
  }
  @Delete() @HttpCode(204) remove() {
    return undefined;
  }
}

describe('Foundation HTTP contract', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApplication([FixtureController]);
  });
  afterAll(async () => {
    await app.close();
  });
  const api = () => request(app.getHttpServer());

  it('exposes raw Terminus liveness with security headers and server-generated correlation ID', async () => {
    const response = await api()
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'attacker-id')
      .expect(200);
    expect(response.body).toMatchObject({ status: 'ok', info: { process: { status: 'up' } } });
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('reports readiness and returns 503 when shutting down', async () => {
    await api().get('/api/v1/health/ready').expect(200);
    app.get(LifecycleService).beforeApplicationShutdown();
    await api().get('/api/v1/health/ready').expect(503);
  });
  it('wraps successful JSON exactly once', async () => {
    const response = await api().post('/api/v1/fixture').send({ name: 'Ada' }).expect(201);
    expect(response.body).toEqual({ success: true, data: { name: 'Ada' } });
  });
  it('rejects unknown input fields and excludes submitted values from errors', async () => {
    const response = await api()
      .post('/api/v1/fixture')
      .send({ name: 'A', password: 'SECRET' })
      .expect(400);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Validation failed',
      statusCode: 400,
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });
  it.each([
    '/api/v1/fixture?limit=101',
    '/api/v1/fixture?page=-1',
    '/api/v1/fixture?sortBy=passwordHash',
  ])('rejects unsafe list input: %s', async (path) => {
    await api().get(path).expect(400);
  });
  it('converts numeric query strings explicitly', async () => {
    const response = await api().get('/api/v1/fixture?page=2&limit=10').expect(200);
    expect(response.body).toMatchObject({ data: { meta: { page: 2, limit: 10 } } });
  });
  it('hides unexpected error details and sensitive query strings', async () => {
    const response = await api().get('/api/v1/fixture/error?token=SECRET').expect(500);
    expect(response.body).toMatchObject({
      message: 'Internal server error',
      path: '/api/v1/fixture/error',
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
    expect(response.body).toHaveProperty('requestId', response.headers['x-request-id']);
  });
  it('preserves stable application error codes', async () => {
    const response = await api().get('/api/v1/fixture/conflict').expect(409);
    expect(response.body).toMatchObject({ code: 'ACCOUNT_CONFLICT', message: 'Account conflict' });
  });
  it('returns safe 400 errors for malformed JSON', async () => {
    const response = await api()
      .post('/api/v1/fixture')
      .type('json')
      .send('{"password":"SECRET",')
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });
  it('caps request payloads at 16 KiB', async () => {
    await api()
      .post('/api/v1/fixture')
      .send({ name: 'a'.repeat(17000) })
      .expect(413);
  });
  it('preserves raw responses and empty 204 bodies', async () => {
    const raw = await api().get('/api/v1/fixture/raw').expect(200);
    expect(raw.body).toEqual({ protocol: 'raw' });
    expect((await api().delete('/api/v1/fixture').expect(204)).text).toBe('');
  });
  it('allows only exact configured browser origins', async () => {
    const allowed = await api().get('/api/v1/health/live').set('Origin', 'https://app.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const denied = await api().get('/api/v1/health/live').set('Origin', 'https://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('keeps Swagger disabled by default and requires the URI version', async () => {
    await api().get('/docs').expect(404);
    await api().get('/api/health/live').expect(404);
  });
  it('does not echo query secrets in Nest default 404 messages', async () => {
    const response = await api().get('/api/v1/missing?token=SECRET').expect(404);
    expect(response.body).toMatchObject({ message: 'Resource not found' });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });
});

describe('Rate limiting', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApplication([FixtureController], { RATE_LIMIT_MAX: 2 });
  });
  afterAll(async () => {
    await app.close();
  });
  it('returns standardized 429 errors and cannot be bypassed with a forged forwarded address', async () => {
    const api = request(app.getHttpServer());
    await api.get('/api/v1/fixture/raw').expect(200);
    await api.get('/api/v1/fixture/raw').expect(200);
    const response = await api
      .get('/api/v1/fixture/raw')
      .set('X-Forwarded-For', '203.0.113.4')
      .expect(429);
    expect(response.body).toMatchObject({ success: false, statusCode: 429 });
    expect(response.headers['retry-after']).toBeDefined();
    await api.get('/api/v1/health/live').expect(200);
  });
});

describe('OpenAPI opt-in', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApplication([], { SWAGGER_ENABLED: true });
  });
  afterAll(async () => {
    await app.close();
  });
  it('serves OpenAPI with the actual versioned health paths', async () => {
    const response = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    expect(response.body).toHaveProperty('paths./api/v1/health/live');
  });
});
