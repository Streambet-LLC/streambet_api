import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { isClientOrigin, originOf } from '../../common/utils/client-origins';

/**
 * Google OAuth guard that remembers which of our sites started the flow.
 * `GET /auth/google?origin=https://…` carries the origin through OAuth
 * `state`, so the callback can send the tokens back to that site (e.g. the
 * Hermes Auctions domain) instead of always the main one. Only our own
 * origins are accepted; anything else falls back to the main site.
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.query?.origin;
    // Only the start of the flow has ?origin; Google's callback has ?state.
    if (typeof raw !== 'string' || !isClientOrigin(this.config, raw)) {
      return undefined;
    }
    return { state: originOf(raw) ?? undefined };
  }
}
