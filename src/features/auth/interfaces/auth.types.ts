import type { Request } from 'express';
import type { RequestAuthority } from '../../authorization/interfaces/authority';

export interface Principal {
  userId: string;
  sessionId: string;
  email: string;
  userType: string;
}
export interface LoginIdentity {
  userId: string;
  credentialStamp: string;
}
export interface AuthRequest extends Request {
  principal?: Principal;
  loginIdentity?: LoginIdentity;
  authority?: RequestAuthority;
}
export interface ClientDevice {
  name?: string;
  userAgent?: string;
  ip?: string;
}
export interface IssuedCredentials {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
  sessionExpiresAt: Date;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string | undefined, password: string): Promise<boolean>;
}
export const VERIFICATION_MESSAGE = Symbol('VERIFICATION_MESSAGE');
export interface PreparedVerification {
  recipient: string;
  template: string;
  payloadCiphertext: Buffer;
  keyId: string;
}
export interface VerificationMessageFactory {
  prepare(email: string, token: string): PreparedVerification;
}
