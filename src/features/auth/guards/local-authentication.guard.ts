import { BadRequestException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { LoginDto } from '../dto/auth.dto';
import { LocalStrategy } from '../strategies/local.strategy';
import type { AuthRequest } from '../interfaces/auth.types';

@Injectable()
export class LocalAuthenticationGuard implements CanActivate {
  private readonly validation = createValidationPipe();
  constructor(private readonly strategy: LocalStrategy) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    // Nest guards precede route pipes. Validate credentials before the strategy sees them.
    const body: unknown = await this.validation.transform(request.body, {
      type: 'body',
      metatype: LoginDto,
    });
    if (!(body instanceof LoginDto)) throw new BadRequestException('Invalid login input');
    request.loginIdentity = await this.strategy.authenticate(body.email, body.password);
    return true;
  }
}
