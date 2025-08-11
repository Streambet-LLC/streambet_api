import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GeoFencingService } from './geo-fencing.service';
import { extractIpFromRequest } from 'src/common/utils/ip-utils';

@Injectable()
export class GeoFencingGuard implements CanActivate {
  private readonly logger = new Logger(GeoFencingGuard.name);

  constructor(private readonly geoFencingService: GeoFencingService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const ip = extractIpFromRequest(req);
    //is for debuging purpose will remove after checking
    console.log(ip, 'ip address');

    if (!ip) {
      this.logger.warn('Could not determine IP for request');
      throw new ForbiddenException('Unable to determine client IP');
    }

    const loc = await this.geoFencingService.lookup(ip);
    req.geo = loc ?? null;

    // Config: blocked countries CSV (ISO2)
    const blocked = (process.env.BLOCKED_STATE_CODES || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (loc?.country_code && blocked.includes(loc.country_code.toUpperCase())) {
      this.logger.warn(`Blocked country request: ${loc.country_code} ip=${ip}`);
      throw new ForbiddenException('Access from your country is restricted');
    }

    const blockVpn =
      String(process.env.BLOCK_VPN || '').toLowerCase() === 'true';
    if (blockVpn && loc?.isVpn) {
      this.logger.warn(`Blocked VPN/proxy ip=${ip}`);
      throw new ForbiddenException('Access from VPN/proxy is restricted');
    }

    // pass
    return true;
  }
}
