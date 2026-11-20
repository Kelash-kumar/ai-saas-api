/** Public deterministic keys for isolated tests only. Never production credentials. */
export const testAuthSettings = {
  AUTH_JWT_KEY: Buffer.alloc(32, 1).toString('base64'),
  AUTH_CSRF_KEY: Buffer.alloc(32, 2).toString('base64'),
  AUTH_OUTBOX_KEY: Buffer.alloc(32, 3).toString('base64'),
};

export const testProductionMailSettings = {
  MAIL_TRANSPORT: 'smtp',
  MAIL_SMTP_HOST: 'smtp.example.test',
  MAIL_PUBLIC_URL: 'https://app.example.test',
  MAIL_FROM: 'no-reply@example.test',
};
