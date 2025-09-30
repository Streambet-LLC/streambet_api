import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';
import { CoinflowWebhookGuard } from './guards/coinflow-webhook.guard';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: configService.get<string>('auth.jwtExpiresIn'),
        },
      }),
    }),
    UsersModule,
    WalletsModule,
    GeoFencingModule,
    NotificationModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    RefreshTokenGuard,
    CoinflowWebhookGuard,
  ],
  exports: [PassportModule, JwtModule, AuthService],
})
export class AuthModule {}
