import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GeoFencingService } from '../../geo-fencing/geo-fencing.service';
import { extractIpFromRequest } from 'src/common/utils/ip-utils';
import { ConfigService } from '@nestjs/config';

@Injectable()
/**
 * Guard to enforce geo-fencing and VPN/proxy restrictions on incoming requests.
 * - Checks client IP and looks up geographic location.
 * - Blocks access from configured countries.
 * - Blocks access from VPN/proxy if configured.
 */
export class GeoFencingGuard implements CanActivate {
  constructor(
    private readonly geoFencingService: GeoFencingService, // service to lookup geo info by IP
    private readonly configService: ConfigService, // access to application configuration
  ) {}

  /**
   * Determines whether a request is allowed to proceed.
   * @param ctx - Execution context provided by NestJS
   * @returns boolean - true if request passes checks, otherwise throws ForbiddenException
   */
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Extract the HTTP request object
    const req = ctx.switchToHttp().getRequest();

    // Extract client IP (supports proxies, etc.)
    const ip = extractIpFromRequest(req);

    // If IP cannot be determined, block request and force logout
    if (!ip) {
      Logger.warn('Could not determine IP for request');
      throw new ForbiddenException({
        message: 'Unable to determine client IP',
        isForcedLogout: true,
      });
    }

    // Lookup geographic info from IP
    const loc = await this.geoFencingService.lookup(ip);
    req.geo = loc ?? null; // attach geo info to request for later use

    // --- Check for blocked countries ---
    const blockedRegion = this.configService.get<string>('geo.blockedRegion');
    const blocked = (blockedRegion || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean); // convert comma-separated string to array
    if (loc?.region && blocked.includes(loc.region)) {
      Logger.warn(`Blocked country request: ${loc.region} ip=${ip}`);
      throw new ForbiddenException({
        message: `Access from your region-${loc.region} is restricted`,
	// 	        isForcedLogout: true,
    //   });
    // }

    // // --- Check for VPN/proxy if blocking is enabled ---
    // const blockVPN = this.configService.get<string>('geo.blockVPN');
    // const isBlockVPN = blockVPN === 'true'; // convert string to boolean
    // if (isBlockVPN && Boolean(loc?.isVpn)) {
    //   Logger.warn(`Blocked VPN/proxy ip=${ip}`);
    //   throw new ForbiddenException({
    //     message: 'Access from VPN/proxy is restricted',
        isForcedLogout: true,
      });
    }

    // All checks passed, allow request
    return true;
  }
}
