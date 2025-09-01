import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const errorResponse = exception.getResponse();
    const er =
      typeof errorResponse === 'object' && errorResponse !== null
        ? (errorResponse as Record<string, any>)
        : null;

    const error: Record<string, any> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: er?.message ?? exception.message ?? 'Internal server error',
    };
    if (er && 'isForcedLogout' in er) {
      error.isForcedLogout = Boolean(er.isForcedLogout);
    }

    if (status === 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception.stack,
        'HttpExceptionFilter',
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url}`,
        JSON.stringify(error),
        'HttpExceptionFilter',
      );
    }

    response.status(status).json(error);
  }
}
