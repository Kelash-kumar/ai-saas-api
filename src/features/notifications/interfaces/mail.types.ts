import type { PreparedVerification } from '../../auth/interfaces/auth.types';

export const mailTemplates = [
  'verify_email',
  'password_reset',
  'account_activation',
  'password_changed',
  'account_deactivated',
  'account_activated',
  'account_suspended',
  'account_restored',
] as const;
export type MailTemplate = (typeof mailTemplates)[number];
export type RecoveryPurpose = 'password_reset' | 'account_activation';
export const SECURITY_MESSAGES = Symbol('SECURITY_MESSAGES');
export interface SecurityMessages {
  prepare(template: MailTemplate, recipient: string, token?: string): PreparedVerification;
}
export interface MailPayload {
  token?: string;
}
export interface Delivery {
  id: string;
  to: string;
  subject: string;
  text: string;
}
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
export interface MailTransport {
  send(message: Delivery): Promise<void>;
}
export class DeliveryError extends Error {
  constructor(
    readonly code:
      | 'SMTP_TRANSIENT'
      | 'SMTP_PERMANENT'
      | 'DELIVERY_TIMEOUT'
      | 'INVALID_PAYLOAD'
      | 'FILE_DELIVERY'
      | 'PROCESSING_TRANSIENT',
    readonly permanent: boolean,
  ) {
    super(code);
  }
}
