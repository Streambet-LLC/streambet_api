import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export const getTypeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get('DB_HOST'),
  port: configService.get('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_DATABASE'),
  entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
  synchronize: configService.get('NODE_ENV') !== 'production',
  migrations: [join(__dirname, 'src/database/migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
  logging: configService.get('NODE_ENV') === 'development',
});
