import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { MailConfig } from '../../core/config/mail-config.service';
import type { Delivery, MailPayload } from './interfaces/mail.types';
import { DeliveryError } from './interfaces/mail.types';

const templates: Record<string, { subject: string; text: string; route?: string }> = {
  account_suspended: {
    subject: 'Your account was suspended',
    text: 'An authorized administrator suspended your account and signed out all sessions. Contact support; self-service reactivation cannot override an administrative block.',
  },
  account_restored: {
    subject: 'Your account was restored',
    text: 'An authorized administrator restored your account. Previous sessions remain signed out; verify your email if needed and sign in again.',
  },
  verify_email: {
    subject: 'Verify your email',
    text: 'Verify your email using this link:',
    route: 'verify-email',
  },
  password_reset: {
    subject: 'Reset your password',
    text: 'Reset your password using this link. If you did not request it, ignore this message:',
    route: 'reset-password',
  },
  account_activation: {
    subject: 'Reactivate your account',
    text: 'Reactivate your self-deactivated account using this link:',
    route: 'activate-account',
  },
  password_changed: {
    subject: 'Your password changed',
    text: 'Your password changed and all sessions were signed out. If this was not you, use password recovery or contact support.',
  },
  account_deactivated: {
    subject: 'Your account was deactivated',
    text: 'Your account was deactivated and all sessions were signed out. You can request self-service reactivation.',
  },
  account_activated: {
    subject: 'Your account was reactivated',
    text: 'Your account was reactivated. Sign in again to start a new session.',
  },
};

@Injectable()
export class MailRenderer {
  constructor(private readonly config: MailConfig) {}
  render(id: string, template: string, recipient: string, payload: MailPayload): Delivery {
    const entry = templates[template];
    if (
      !Object.hasOwn(templates, template) ||
      !entry ||
      !isEmail(recipient) ||
      /[\r\n]/.test(recipient)
    )
      throw new DeliveryError('INVALID_PAYLOAD', true);
    let text = entry.text;
    if (entry.route) {
      if (!payload.token) throw new DeliveryError('INVALID_PAYLOAD', true);
      const base = `${this.config.settings.publicUrl.replace(/\/$/, '')}/`;
      const url = new URL(entry.route, base);
      // Fragment stays out of ordinary HTTP server URL/query logs. The frontend posts the token in JSON.
      url.hash = `token=${payload.token}`;
      text += `\n\n${url.toString()}\n\nThis link expires. Do not share it.`;
    }
    return { id, to: recipient, subject: entry.subject, text };
  }
}
