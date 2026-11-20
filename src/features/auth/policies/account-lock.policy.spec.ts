import { failedAttempt } from './account-lock.policy';

describe('Account lock policy', () => {
  const policy = { maxAttempts: 5, lockSeconds: 900 };
  it('locks at the configured threshold and caps the attempt counter', () => {
    const at = new Date('2026-11-20T00:00:00Z');
    expect(failedAttempt({ failedLoginAttempts: 4, lockedUntil: null }, policy, at)).toEqual({
      attempts: 5,
      lockedUntil: new Date(at.getTime() + 900000),
    });
    expect(
      failedAttempt({ failedLoginAttempts: 999, lockedUntil: null }, policy, at).attempts,
    ).toBe(5);
  });
  it('starts a fresh counter after an expired lock instead of immediately locking again', () => {
    expect(
      failedAttempt({ failedLoginAttempts: 5, lockedUntil: new Date(0) }, policy, new Date()),
    ).toEqual({ attempts: 1, lockedUntil: null });
  });
});
