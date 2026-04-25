import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  private newRelic: any;

  constructor(private readonly configService: ConfigService) {
    if (
      this.configService.getOrThrow('app.isNewRelicEnable', { infer: true })
    ) {
      import('newrelic')
        .then((module) => {
          this.newRelic = module.default || module;
        })
        .catch((error) => {
          this.logger.error('Failed to load New Relic module', error);
        });
    }
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const fallbackStatus =
      typeof (exception as { status?: unknown })?.status === 'number'
        ? Number((exception as { status?: number }).status)
        : typeof (exception as { statusCode?: unknown })?.statusCode ===
            'number'
          ? Number((exception as { statusCode?: number }).statusCode)
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const httpStatus = isHttpException ? exception.getStatus() : fallbackStatus;

    const errorResponse = isHttpException ? exception.getResponse() : null;
    const er =
      typeof errorResponse === 'object' && errorResponse !== null
        ? (errorResponse as Record<string, any>)
        : null;
    const error: Record<string, any> = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message:
        er?.message ??
        (isHttpException ? exception.message : (exception as Error)?.message) ??
        'Internal server error',
    };
    if (er && 'isForcedLogout' in er) {
      error.isForcedLogout = Boolean(er.isForcedLogout);
    }
    if (httpStatus === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
        'HttpExceptionFilter',
      );
      this.newRelic?.noticeError?.(exception);
    } else {
      this.logger.warn(
        `${request.method} ${request.url}`,
        JSON.stringify(error),
        'HttpExceptionFilter',
      );
    }

    response.status(httpStatus).json(error);
  }
}
