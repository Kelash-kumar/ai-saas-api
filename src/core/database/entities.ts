import { UserEntity } from '../../features/users/entities/user.entity';
import { RoleEntity } from '../../features/authorization/entities/role.entity';
import { PermissionEntity } from '../../features/authorization/entities/permission.entity';
import { UserRoleEntity } from '../../features/authorization/entities/user-role.entity';
import { RolePermissionEntity } from '../../features/authorization/entities/role-permission.entity';
import { UserPermissionEntity } from '../../features/authorization/entities/user-permission.entity';
import { RoleInheritanceEntity } from '../../features/authorization/entities/role-inheritance.entity';
import { SessionEntity } from '../../features/sessions/entities/session.entity';
import { RefreshTokenEntity } from '../../features/sessions/entities/refresh-token.entity';
import { PasswordResetTokenEntity } from '../../features/auth/entities/password-reset-token.entity';
import { EmailVerificationTokenEntity } from '../../features/auth/entities/email-verification-token.entity';
import { MailOutboxEntity } from '../../features/notifications/entities/mail-outbox.entity';
import { AccountActivationTokenEntity } from '../../features/auth/entities/account-activation-token.entity';

/** Explicit metadata registry; shared by runtime, migrations and tests, without business imports. */
export const entities = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  UserRoleEntity,
  RolePermissionEntity,
  UserPermissionEntity,
  RoleInheritanceEntity,
  SessionEntity,
  RefreshTokenEntity,
  PasswordResetTokenEntity,
  EmailVerificationTokenEntity,
  MailOutboxEntity,
  AccountActivationTokenEntity,
];
