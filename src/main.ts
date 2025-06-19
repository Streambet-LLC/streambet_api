import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('HTTP');
  app.setViewEngine('ejs');

  app.setBaseViewsDir(join(__dirname, '..', 'templates'));

  // Get ConfigService
  const configService = app.get(ConfigService);

  // Set up global prefix
  app.setGlobalPrefix('api');

  // Apply global pipes, filters, and interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(configService));

  // Security middleware
  app.use(helmet());
  app.enableCors();

  // Swagger configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Streambet API')
    .setDescription('The Streambet API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management endpoints')
    .addTag('wallets', 'Wallet and transaction endpoints')
    .addTag('betting', 'Stream and betting endpoints')
    .addTag('payments', 'Payment processing endpoints')
    .addTag('admin', 'Admin control endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Start server
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`API Documentation available at: ${await app.getUrl()}/api/docs`);
}
void bootstrap();
