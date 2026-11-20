export interface FailedAttemptState {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}
export function failedAttempt(
  user: FailedAttemptState,
  policy: { maxAttempts: number; lockSeconds: number },
  at: Date,
) {
  const attempts = Math.min(
    (user.lockedUntil ? 0 : user.failedLoginAttempts) + 1,
    policy.maxAttempts,
  );
  return {
    attempts,
    lockedUntil:
      attempts >= policy.maxAttempts ? new Date(at.getTime() + policy.lockSeconds * 1000) : null,
  };
}
