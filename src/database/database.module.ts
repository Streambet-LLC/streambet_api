import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
        migrations: [join(__dirname, './migrations/*{.ts,.js}')],
        migrationsTableName: 'migrations',
        migrationsRun: false, // We'll run migrations manually
        synchronize: configService.get('NODE_ENV') === 'development', // Only for development
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
  ],
})
export class DatabaseModule {}
