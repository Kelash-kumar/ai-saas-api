import type { UserEntity } from '../entities/user.entity';
import type { PageQueryDto } from '../../../common/pagination/page-query.dto';
import type { Page } from '../../../common/pagination/page';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
export interface NewUser {
  email: string;
  passwordHash: string;
  userType?: string;
}
export interface UserFilters {
  status?: 'active' | 'inactive';
  userType?: string;
}

/** Application-facing port. ORM-specific bulk operations stay in the adapter. */
export interface UsersRepository {
  createUser(input: NewUser): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findCredentials(email: string): Promise<UserEntity | null>;
  list(query: PageQueryDto, filters?: UserFilters): Promise<Page<UserEntity>>;
}
