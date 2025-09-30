import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CoinflowWebhookGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader: string | undefined =
      request.headers['authorization'];

    const webhookSecret =
      this.configService.get<string>('coinflow.webhookSecret') || '';

    if (!webhookSecret) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }

    const provided = (authorizationHeader || '').replace(/^Bearer\s+/i, '');
    if (!provided || provided !== webhookSecret) {
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    return true;
  }
}


