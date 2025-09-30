import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { WS_CORS_ORIGIN } from 'src/common/constants/ws.constants';

/**
 * SocketIoAdapter
 * ----------------
 * A custom WebSocket adapter for NestJS using Socket.IO.
 *
 * - Reads allowed CORS origins from ConfigService.
 * - Supports multiple origins (comma-separated in config).
 * - Falls back to allowing all origins if not configured.
 * - Logs the configured origins for debugging.
 *
 * This ensures a centralized, consistent setup for Socket.IO across the app.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService, // Injected ConfigService to access env variables
  ) {
    super(app);
  }

  /**
   * Creates a Socket.IO server with CORS configured.
   *
   * @param port - Port where the Socket.IO server should run
   * @param options - Additional Socket.IO server options
   * @returns Configured Socket.IO server instance
   */
  createIOServer(port: number, options?: ServerOptions) {
    // Get allowed CORS origins from config (env variable), fallback to empty string
    const allowed = this.config.get<string>(WS_CORS_ORIGIN, '');

    // If config has values → split by comma, trim spaces, remove empty entries
    // Else → allow all origins (true)
    const origins = allowed
      ? allowed
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : true;

    // Log which origins are allowed for debugging
    if (Array.isArray(origins)) {
      Logger.log(
        `Socket.IO CORS origins: ${origins.join(', ')}`,
        SocketIoAdapter.name,
      );
    } else {
      Logger.log(`Socket.IO CORS origins: all (*)`, SocketIoAdapter.name);
    }

    // Create the Socket.IO server with configured CORS
    return super.createIOServer(port, {
      ...options, // Merge with existing options
      cors: { origin: origins, credentials: true }, // Always allow credentials for auth
    });
  }
}
