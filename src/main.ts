import 'dotenv/config';
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

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { STREAM_LIVE_QUEUE } from './common/constants/queue.constants';
import { getQueueToken } from '@nestjs/bullmq';


async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true); // This configuration is applicable only when ALB-only access is enforced. In production, our services are deployed on AWS ECS and are accessible exclusively through the Application Load Balancer (ALB), with no direct access to the underlying containers
  const logger = new Logger('HTTP');
  app.setViewEngine('ejs');

  app.setBaseViewsDir(join(__dirname, '..', 'templates'));

  // Get ConfigService
  const configService = app.get(ConfigService);

  // Create your queue instance
  const streamLiveQueue = app.get<Queue>(getQueueToken(STREAM_LIVE_QUEUE));

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(streamLiveQueue)],
    serverAdapter,
  });

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

  if (configService.get<boolean>('app.isBullmqUiEnabled')) {
    app.use('/admin/queues', serverAdapter.getRouter());
  }

  // Enable based on env
  if (configService.get<boolean>('app.isSwaggerEnable')) {
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
  }
  // Start server
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`API Documentation available at: ${await app.getUrl()}/api/docs`);
}
void bootstrap();
