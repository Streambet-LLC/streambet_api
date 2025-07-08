import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService, ConfigFactory } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { BettingModule } from './betting/betting.module';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsModule } from './payments/payments.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource, DataSourceOptions } from 'typeorm';
import databaseConfig from './config/database.config';
import authConfig from './config/auth.config';
import throttleConfig from './config/throttle.config';
import appConfig from './config/app.config';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AssetsModule } from './assets/assets.module';
import fileConfig from './config/file.config';
import { MailerModule } from '@nestjs-modules/mailer';
import emailConfig from './config/email.config';
import { StreamModule } from './stream/stream.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        throttleConfig,
        appConfig,
        fileConfig,
        emailConfig,
      ] as ConfigFactory[],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        ({
          type: 'postgres',
          host: configService.get('database.host'),
          port: configService.get('database.port'),
          username: configService.get('database.username'),
          password: configService.get('database.password'),
          database: configService.get('database.name'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get('database.synchronize'),
          logging: configService.get('database.logging'),
          dropSchema: configService.get('database.dropSchema'),
        }) as DataSourceOptions,
      dataSourceFactory: async (options) => {
        const dataSource = await new DataSource(options).initialize();
        return dataSource;
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('throttle.ttl'),
            limit: configService.get<number>('throttle.limit'),
          },
        ],
      }),
    }),
    AuthModule,
    AssetsModule,
    UsersModule,
    AdminModule,
    BettingModule,
    WalletsModule,
    PaymentsModule,
    MailerModule,
    StreamModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
}
