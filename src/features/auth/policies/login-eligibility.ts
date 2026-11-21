import type { UserEntity } from '../../users/entities/user.entity';
/** Admin approval permits managed access without claiming that the mailbox has been verified. */
export function loginEligible(user: UserEntity | null, at: Date): user is UserEntity {
  return (
    !!user &&
    !user.deletedAt &&
    user.status === 'active' &&
    !!(user.emailVerifiedAt || user.accessApprovedAt) &&
    (!user.lockedUntil || user.lockedUntil <= at)
  );
}
