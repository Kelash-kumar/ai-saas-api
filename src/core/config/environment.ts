import Joi from 'joi';

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  APP_NAME: string;
  SWAGGER_ENABLED: boolean;
  CORS_ORIGINS: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  SHUTDOWN_TIMEOUT_MS: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_SSL: boolean;
  DATABASE_POOL_MAX: number;
  DATABASE_TIMEOUT_MS: number;
  AUTH_JWT_KEY: string;
  AUTH_CSRF_KEY: string;
  AUTH_OUTBOX_KEY: string;
  AUTH_OUTBOX_KEY_ID: string;
  AUTH_JWT_ISSUER: string;
  AUTH_JWT_AUDIENCE: string;
  AUTH_ACCESS_TTL_SECONDS: number;
  AUTH_REFRESH_TTL_SECONDS: number;
  AUTH_VERIFICATION_TTL_SECONDS: number;
  AUTH_LOGIN_MAX_ATTEMPTS: number;
  AUTH_LOCK_SECONDS: number;
  AUTH_RESET_TTL_SECONDS: number;
  AUTH_ACTIVATION_TTL_SECONDS: number;
  MAIL_TRANSPORT: 'file' | 'smtp';
  MAIL_FROM: string;
  MAIL_PUBLIC_URL: string;
  MAIL_SMTP_HOST: string;
  MAIL_SMTP_PORT: number;
  MAIL_SMTP_SECURE: boolean;
  MAIL_SMTP_REQUIRE_TLS: boolean;
  MAIL_SMTP_USER: string;
  MAIL_SMTP_PASSWORD: string;
  MAIL_TIMEOUT_MS: number;
  MAIL_LEASE_MS: number;
  MAIL_MAX_ATTEMPTS: number;
  MAIL_POLL_MS: number;
}

const schema = Joi.object<Environment>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HOST: Joi.string().hostname().default('127.0.0.1'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  APP_NAME: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .max(80)
    .default('auth-foundation'),
  SWAGGER_ENABLED: Joi.boolean().default(false),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  RATE_LIMIT_TTL_MS: Joi.number().integer().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).max(100000).default(100),
  SHUTDOWN_TIMEOUT_MS: Joi.number().integer().min(1000).max(120000).default(10000),
  DATABASE_HOST: Joi.string().hostname().default('127.0.0.1'),
  DATABASE_PORT: Joi.number().integer().min(1).max(65535).default(55432),
  DATABASE_NAME: Joi.string()
    .pattern(/^[a-z][a-z0-9_]{0,62}$/)
    .default('auth_foundation'),
  DATABASE_USER: Joi.string()
    .pattern(/^[a-z][a-z0-9_]{0,62}$/)
    .default('foundation'),
  DATABASE_PASSWORD: Joi.string().min(12).required(),
  DATABASE_SSL: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.valid(true).required(),
    otherwise: Joi.boolean().default(false),
  }),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DATABASE_TIMEOUT_MS: Joi.number().integer().min(500).max(30000).default(3000),
  AUTH_JWT_KEY: Joi.string().base64().length(44).required(),
  AUTH_CSRF_KEY: Joi.string().base64().length(44).required(),
  AUTH_OUTBOX_KEY: Joi.string().base64().length(44).required(),
  AUTH_OUTBOX_KEY_ID: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]{1,64}$/)
    .default('local-v1'),
  AUTH_JWT_ISSUER: Joi.string().max(100).default('auth-foundation'),
  AUTH_JWT_AUDIENCE: Joi.string().max(100).default('foundation-api'),
  AUTH_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(900).default(900),
  AUTH_REFRESH_TTL_SECONDS: Joi.number().integer().min(3600).max(2592000).default(604800),
  AUTH_VERIFICATION_TTL_SECONDS: Joi.number().integer().min(300).max(86400).default(3600),
  AUTH_LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(3).max(20).default(5),
  AUTH_LOCK_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  AUTH_RESET_TTL_SECONDS: Joi.number().integer().min(300).max(3600).default(1800),
  AUTH_ACTIVATION_TTL_SECONDS: Joi.number().integer().min(300).max(86400).default(3600),
  MAIL_TRANSPORT: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.valid('smtp').required(),
    otherwise: Joi.valid('file', 'smtp').default('file'),
  }),
  MAIL_FROM: Joi.string()
    .email({ tlds: { allow: false } })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default('no-reply@example.test'),
    }),
  MAIL_PUBLIC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default('http://localhost:5173'),
    }),
  MAIL_SMTP_HOST: Joi.string()
    .hostname()
    .when('MAIL_TRANSPORT', {
      is: 'smtp',
      then: Joi.required(),
      otherwise: Joi.string().default('127.0.0.1'),
    }),
  MAIL_SMTP_PORT: Joi.number().integer().min(1).max(65535).default(587),
  MAIL_SMTP_SECURE: Joi.boolean().default(false),
  MAIL_SMTP_REQUIRE_TLS: Joi.boolean().default(true),
  MAIL_SMTP_USER: Joi.string().allow('').default(''),
  MAIL_SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_TIMEOUT_MS: Joi.number().integer().min(500).max(10000).default(5000),
  MAIL_LEASE_MS: Joi.number().integer().min(15000).max(300000).default(60000),
  MAIL_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(5),
  MAIL_POLL_MS: Joi.number().integer().min(100).max(60000).default(1000),
});

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = schema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
  });
  if (result.error) {
    // Never echo environment values (future fields may contain credentials).
    const fields = result.error.details.map((detail) => detail.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const env = result.value;
  const publicUrl = new URL(env.MAIL_PUBLIC_URL);
  if (
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash ||
    (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')
  )
    throw new Error(
      'MAIL_PUBLIC_URL must be a trusted HTTP(S) base URL without credentials, query or fragment; production requires HTTPS',
    );
  if (env.NODE_ENV === 'production' && !env.MAIL_SMTP_SECURE && !env.MAIL_SMTP_REQUIRE_TLS)
    throw new Error('Production SMTP requires verified TLS');
  if (!!env.MAIL_SMTP_USER !== !!env.MAIL_SMTP_PASSWORD)
    throw new Error('SMTP credentials must be supplied together');
  if (env.MAIL_LEASE_MS < env.MAIL_TIMEOUT_MS * 4 + 1000)
    throw new Error('MAIL_LEASE_MS must exceed the delivery timeout budget');
  const keys = [env.AUTH_JWT_KEY, env.AUTH_CSRF_KEY, env.AUTH_OUTBOX_KEY];
  if (
    keys.some(
      (key) =>
        Buffer.from(key, 'base64').length !== 32 ||
        Buffer.from(key, 'base64').toString('base64') !== key,
    ) ||
    new Set(keys).size !== 3
  ) {
    throw new Error('Authentication keys must be distinct, base64-encoded 32-byte keys');
  }
  const origins = env.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins');
    }
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('Production CORS_ORIGINS must use HTTPS');
    }
  }
  return env;
}
