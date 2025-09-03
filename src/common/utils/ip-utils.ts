import { isIP } from 'net';

export function normalizeIp(ip?: string): string | null {
  if (!ip) return null;
  const cleaned = String(ip)
    .replace(/^::ffff:/, '')
    .trim();
  return isIP(cleaned) ? cleaned : null;
}

/**
 * Extract client IP from Express request safely.
 * - If trust proxy is enabled in Express, prefer req.ip
 * - Otherwise check X-Forwarded-For header, then socket.remoteAddress
 */
export function extractIpFromRequest(req: any): string | null {
  // 1) req.ip (Express + trust proxy)
  if (req?.ip) {
    const ip = normalizeIp(req.ip);
    if (ip) return ip;
  }

  // 2) X-Forwarded-For header (left-most address)
  const xff =
    req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For'];
  if (xff) {
    const leftmost = String(Array.isArray(xff) ? xff[0] : xff)
      .split(',')[0]
      .trim();
    const ip = normalizeIp(leftmost);
    if (ip) return ip;
  }

  // 3) fallback to socket remote address
  const remote = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  return normalizeIp(remote);
}

export function extractIpFromSocket(socket: any): string | null {
  // Socket.IO - handshake headers or socket.handshake.address
  const h = socket?.handshake;
  if (h?.address) {
    const ip = normalizeIp(h.address);
    if (ip) return ip;
  }
  const xff = h?.headers?.['x-forwarded-for'];
  if (xff) {
    const leftmost = String(Array.isArray(xff) ? xff[0] : xff)
      .split(',')[0]
      .trim();
    const ip = normalizeIp(leftmost);
    if (ip) return ip;
  }
  // fallback
  return normalizeIp(socket?.conn?.remoteAddress);
}
