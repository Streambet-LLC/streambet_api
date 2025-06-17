import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  constructor(private configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enableApiLogging = this.configService.get<boolean>(
      'app.enableApiLogging',
      true,
    );
    const enableDetailedLogging = this.configService.get<boolean>(
      'app.enableDetailedLogging',
      false,
    );

    if (!enableApiLogging) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const method = request.method;
    const originalUrl = request.originalUrl;
    const ip = request.ip;
    const body = request.body as Record<string, unknown>;
    const query = request.query as Record<string, unknown>;
    const params = request.params as Record<string, unknown>;
    const userAgent = request.get('User-Agent') || '';
    const startTime = Date.now();

    this.logger.log(
      `${method} ${originalUrl} - IP: ${ip} - User-Agent: ${userAgent}`,
    );

    if (enableDetailedLogging) {
      if (body && Object.keys(body).length > 0) {
        const sanitizedBody = this.sanitizeBody(body);
        this.logger.debug(`Request Body: ${JSON.stringify(sanitizedBody)}`);
      }

      if (query && Object.keys(query).length > 0) {
        this.logger.debug(`Query Params: ${JSON.stringify(query)}`);
      }

      if (params && Object.keys(params).length > 0) {
        this.logger.debug(`Path Params: ${JSON.stringify(params)}`);
      }
    }

    return next.handle().pipe(
      tap({
        next: (data: unknown) => {
          const responseTime = Date.now() - startTime;
          const statusCode = response.statusCode;
          const contentLength = response.get('content-length') || 0;

          this.logger.log(
            `${method} ${originalUrl} ${statusCode} ${contentLength}b - ${responseTime}ms`,
          );

          if (enableDetailedLogging && data && typeof data === 'object') {
            const responseData = JSON.stringify(data).substring(0, 500);
            if (responseData.length === 500) {
              this.logger.debug(`Response: ${responseData}... (truncated)`);
            } else {
              this.logger.debug(`Response: ${responseData}`);
            }
          }
        },
        error: (error: unknown) => {
          const responseTime = Date.now() - startTime;
          let statusCode = 500;
          let message = 'Unknown error';

          if (
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            'message' in error
          ) {
            const err = error as { status?: number; message?: string };
            statusCode = err.status ?? 500;
            message = err.message ?? message;
          }

          this.logger.error(
            `${method} ${originalUrl} ${statusCode} - ${responseTime}ms - ${message}`,
          );
        },
      }),
    );
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'refreshToken',
      'accessToken',
    ];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (Object.prototype.hasOwnProperty.call(sanitized, field)) {
        sanitized[field] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}
