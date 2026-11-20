import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

const file = '.env';
let content = readFileSync(existsSync(file) ? file : '.env.example', 'utf8');
const existing = parse(content);
for (const key of ['AUTH_JWT_KEY', 'AUTH_CSRF_KEY', 'AUTH_OUTBOX_KEY']) {
  if (existing[key]) continue;
  const line = `${key}=${randomBytes(32).toString('base64')}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  content = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}
writeFileSync(file, content, { mode: 0o600 });
console.log('Local authentication keys configured in .env; existing keys preserved.');
