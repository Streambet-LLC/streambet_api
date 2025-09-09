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

@Catch(HttpException)
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

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = exception.getResponse();
    const er =
      typeof errorResponse === 'object' && errorResponse !== null
        ? (errorResponse as Record<string, any>)
        : null;
    const error: Record<string, any> = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: er?.message ?? exception.message ?? 'Internal server error',
    };
    if (er && 'isForcedLogout' in er) {
      error.isForcedLogout = Boolean(er.isForcedLogout);
    }
    if (httpStatus === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception.stack,
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
