import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env file
config({ path: '.env' });

// Create configuration service to read environment variables
const configService = new ConfigService();

const dbHost = configService.get<string>('DB_HOST') ?? '';
const sslEnabled =
  configService.get('DB_SSL') === 'true' || /rds\.amazonaws\.com/i.test(dbHost);
if (process.env.DS_DEBUG)
  console.error(`[ds] host=${dbHost} db=${configService.get('DB_DATABASE')} ssl=${sslEnabled}`);

// Create and export a DataSource configuration for TypeORM CLI
export default new DataSource({
  type: 'postgres',
  host: configService.get('DB_HOST'),
  port: configService.get('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_DATABASE'),
  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  logging: process.env.NODE_ENV !== 'production',
  // RDS requires SSL. Enable it when DB_SSL=true or whenever the host is an
  // Amazon RDS endpoint (rejectUnauthorized false because RDS uses an Amazon
  // CA chain we don't bundle locally).
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});
