import { createHash, randomBytes } from 'node:crypto';

export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const tokenDigest = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export const validOpaqueToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
