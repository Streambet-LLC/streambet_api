import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from 'src/enums/user-role.enum';

/**
 * Admin-only gate. Use after JwtAuthGuard. Guards run before validation
 * pipes, so non-admins are refused before their payload is even parsed.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    if (req.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admins only.');
    }
    return true;
  }
}
