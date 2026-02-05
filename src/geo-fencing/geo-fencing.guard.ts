import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GeoFencingService } from './geo-fencing.service';
import { extractIpFromRequest } from 'src/common/utils/ip-utils';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GeoFencingGuard implements CanActivate {
  private readonly logger = new Logger(GeoFencingGuard.name);

  constructor(
    private readonly geoFencingService: GeoFencingService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const ip = extractIpFromRequest(req);
    //is for debuging purpose will remove after checking

    if (!ip) {
      this.logger.warn('Could not determine IP for request');
      throw new ForbiddenException({
        message: 'Unable to determine client IP',
        isForcedLogout: true,
      });
    }

    const loc = await this.geoFencingService.lookup(ip);
    req.geo = loc ?? null;

    // Config: blocked countries
    const blockedRegion = this.configService.get<string>('geo.blockedRegion');
    const blocked = (blockedRegion || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (loc?.region && blocked.includes(loc.region)) {
      this.logger.warn(`Blocked country request: ${loc.region} ip=${ip}`);
      throw new ForbiddenException({
        message: `Access from your region-${loc.region} is restricted`,
        isForcedLogout: true,
      });
    }
    const blockVPN = this.configService.get<string>('geo.blockVPN');

    const isBlockVPN = blockVPN === 'true'; // Convert string to real boolean
    if (isBlockVPN && Boolean(loc?.isVpn)) {
      this.logger.warn(`Blocked VPN/proxy ip=${ip}`);
      throw new ForbiddenException({
        message: 'Access from VPN/proxy is restricted',
        isForcedLogout: true,
      });
    }

    // pass
    return true;
  }
}
