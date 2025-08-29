/**
 * GeoFencingSocketGuard
 * ---------------------
 * WebSocket guard to enforce geo-fencing and VPN/proxy restrictions for socket connections.
 *
 * Functional Overview:
 * 1. Extracts the client's IP address from headers or socket connection.
 * 2. Performs geo-location lookup using GeoFencingService.
 * 3. Attaches the geo-location info to the socket object for later use.
 * 4. Checks if the client's region is blocked and prevents access if necessary.
 * 5. Optionally blocks VPN/proxy connections based on configuration.
 * 6. Throws WsException with forced logout flag if access is restricted.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { GeoFencingService } from '../../geo-fencing/geo-fencing.service';

type SocketWithGeo = Socket & { geo?: any };

/**
 * Extracts the client's IP address from WebSocket headers or connection info.
 * Priority:
 *   1. X-Forwarded-For header
 *   2. X-Real-IP header
 *   3. Handshake address / connection remote address
 *
 * @param client - Socket instance
 * @returns client IP string or null if not found
 */
function getClientIp(client: Socket): string | null {
  const xff = client.handshake?.headers?.['x-forwarded-for'];
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  const xri = client.handshake?.headers?.['x-real-ip'];
  if (typeof xri === 'string' && xri.length > 0) {
    return xri.trim();
  }
  const addr = client.handshake?.address || client.conn?.remoteAddress;
  return addr ? addr.replace('::ffff:', '') : null; // normalize IPv4-mapped IPv6
}

@Injectable()
export class GeoFencingSocketGuard implements CanActivate {
  private readonly logger = new Logger(GeoFencingSocketGuard.name);

  constructor(
    private readonly geoFencingService: GeoFencingService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Guard method executed before a WebSocket event is processed.
   * 1. Extract client IP
   * 2. Perform geo-location lookup
   * 3. Enforce blocked regions
   * 4. Enforce VPN/proxy restrictions if configured
   *
   * @param ctx - ExecutionContext for the WebSocket
   * @returns true if the socket is allowed; throws WsException if blocked
   */
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const client = ctx.switchToWs().getClient<SocketWithGeo>();
    const ip = getClientIp(client);

    // --- Handle missing IP ---
    if (!ip) {
      this.logger.warn('Socket: unable to determine client IP');
      throw new WsException({
        message: 'Unable to determine client IP',
        isForcedLogout: true,
      });
    }

    // --- Geo-location lookup ---
    const loc = await this.geoFencingService.lookup(ip);
    client.geo = loc ?? null; // attach geo info to socket

    // --- Blocked regions check ---
    const blockedRegion = this.config.get<string>('geo.blockedRegion') ?? '';
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

    // --- VPN/Proxy block check ---
    const blockVPN = this.config.get<string>('geo.blockVPN');
    const isBlockVPN = blockVPN === 'true'; // Convert string to boolean
    if (isBlockVPN && Boolean(loc?.isVpn)) {
      this.logger.warn(`Socket blocked by VPN/proxy ip=${ip}`);
      throw new WsException({
        message: 'Access from VPN/proxy is restricted',
        isForcedLogout: true,
      });
    }

    // --- Access allowed ---
    return true;
  }
}
