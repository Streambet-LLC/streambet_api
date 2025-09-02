import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user?: User;
  body: {
    refreshToken: string;
  };
}

@Injectable()
export class RefreshTokenGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const { refreshToken } = request.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required');
    }

    const payload = this.authService.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findUserByUserId(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.deletedAt) {
      throw new UnauthorizedException({
        message: 'Your account has been deleted by Admin',
        userDeleted: true,
      });
    }
    if (user.isActive === false) {
      throw new UnauthorizedException('User is no longer active');
    }

    const storedUser = await this.usersService.findByRefreshToken(refreshToken);
    if (!storedUser || storedUser.id !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (storedUser.deletedAt) {
      throw new UnauthorizedException({
        message: 'Your account has been deleted by Admin',
        userDeleted: true,
      });
    }
    if (storedUser.isActive === false) {
      throw new UnauthorizedException('User is no longer active');
    }

    if (
      storedUser.refreshTokenExpiresAt &&
      storedUser.refreshTokenExpiresAt < new Date()
    ) {
      await this.usersService.update(storedUser.id, {
        refreshToken: null,
        refreshTokenExpiresAt: null,
      });
      throw new UnauthorizedException('Refresh token has expired');
    }

    request.user = storedUser;
    return true;
  }
}
