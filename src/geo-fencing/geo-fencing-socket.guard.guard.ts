// src/common/guards/geo-fencing-socket.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { GeoFencingService } from './geo-fencing.service';

type SocketWithGeo = Socket & { geo?: any };

function getClientIp(client: Socket): string | null {
  // prefer X-Forwarded-For (first ip), then handshake address, then transport address
  const xff = client.handshake?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  const addr = client.handshake?.address || client.conn?.remoteAddress;
  return addr ? addr.replace('::ffff:', '') : null;
}

@Injectable()
export class GeoFencingSocketGuard implements CanActivate {
  private readonly logger = new Logger(GeoFencingSocketGuard.name);

  constructor(
    private readonly geoFencingService: GeoFencingService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const client = ctx.switchToWs().getClient<SocketWithGeo>();
    const ip = getClientIp(client);

    if (!ip) {
      this.logger.warn('Socket: unable to determine client IP');
      throw new WsException({
        message: 'Unable to determine client IP',
        isForcedLogout: true,
      });
    }

    const loc = await this.geoFencingService.lookup(ip);
    client.geo = loc ?? null;

    // blocked regions
    const blockedRegion = this.config.get<string>('GEO_BLOCKED_REGION') ?? '';
    const blocked = blockedRegion
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (loc?.region && blocked.includes(loc.region)) {
      this.logger.warn(`Socket blocked by region: ${loc.region} ip=${ip}`);
      throw new WsException({
        message: `Access from your region - ${loc.region} is restricted`,
        isForcedLogout: true,
      });
    }

    // block VPN
    const isBlockVPN =
      (this.config.get<string>('GEO_BLOCK_VPN') ?? '').toLowerCase() === 'true';
    if (isBlockVPN && Boolean(loc?.isVpn)) {
      this.logger.warn(`Socket blocked by VPN/proxy ip=${ip}`);
      throw new WsException({
        message: 'Access from VPN/proxy is restricted',
        isForcedLogout: true,
      });
    }

    return true;
  }
}
