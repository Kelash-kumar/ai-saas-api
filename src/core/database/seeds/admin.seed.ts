import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { isEmail } from 'class-validator';
import { UserEntity } from '../../../features/users/entities/user.entity';
import { ArgonPasswordHasher } from '../../../features/auth/crypto/argon-password-hasher';
import { AuthorizationRepository } from '../../../features/authorization/repositories/authorization.repository';
import { grantOperatorPermissions } from '../../../features/authorization/bootstrap';
export const developmentAdmin = {
  email: 'admin@example.com',
  password: 'Admin@123456789!',
} as const;
export async function seedAdmin(
  source: DataSource,
  input: { email: string; password: string; environment: string },
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email) || input.password.length < 15 || input.password.length > 128)
    throw new BadRequestException('Seed email or password is invalid');
  if (
    input.environment === 'production' &&
    (email === developmentAdmin.email || input.password === developmentAdmin.password)
  )
    throw new BadRequestException('Production requires explicit non-default seed credentials');
  const hash = await new ArgonPasswordHasher().hash(input.password);
  return source.transaction('READ COMMITTED', async (manager) => {
    const policy = new AuthorizationRepository(manager);
    await policy.lockPolicy();
    let user = await manager
      .getRepository(UserEntity)
      .findOne({ where: { email }, withDeleted: true });
    if (
      user &&
      (user.userType !== 'admin' ||
        user.deletedAt ||
        user.status !== 'active' ||
        !user.emailVerifiedAt ||
        (user.lockedUntil && user.lockedUntil > new Date()))
    )
      throw new ConflictException('Seed refuses to promote or reactivate an existing identity');
    if (!user)
      user = await manager.getRepository(UserEntity).save({
        email,
        passwordHash: hash,
        userType: 'admin',
        emailVerifiedAt: new Date(),
        firstName: 'System',
        lastName: 'Administrator',
      });
    await grantOperatorPermissions(manager, email, true);
    return user.id;
  });
}
