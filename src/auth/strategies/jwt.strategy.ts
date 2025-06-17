import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserResponseDto } from 'src/users/dto/user.response.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('auth.jwtSecret') ||
        'fallback-secret-for-dev',
    });
  }

  async validate(payload: JwtPayload): Promise<UserResponseDto> {
    const { sub: id } = payload;
    const user = await this.usersService.findOne(id);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is no longer active');
    }

    return user;
  }
}
