import { S3ClientConfig } from '@aws-sdk/client-s3';
import { SESClientConfig } from '@aws-sdk/client-ses';
import { registerAs } from '@nestjs/config';
import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { FileConfig } from '../common/types/config.type';
import validateConfig from 'src/common/utils/validate-config';

enum FileDriver {
  LOCAL = 'local',
  S3 = 's3',
}

class EnvironmentVariablesValidator {
  @IsEnum(FileDriver)
  FILE_DRIVER: FileDriver;

  @ValidateIf(
    (envValues: EnvironmentVariablesValidator) =>
      envValues.FILE_DRIVER === FileDriver.S3,
  )
  @IsString()
  ACCESS_KEY_ID: string;

  @ValidateIf(
    (envValues: EnvironmentVariablesValidator) =>
      envValues.FILE_DRIVER === FileDriver.S3,
  )
  @IsString()
  SECRET_ACCESS_KEY: string;

  @ValidateIf(
    (envValues: EnvironmentVariablesValidator) =>
      envValues.FILE_DRIVER === FileDriver.S3,
  )
  @IsString()
  AWS_DEFAULT_S3_BUCKET: string;

  @ValidateIf(
    (envValues: EnvironmentVariablesValidator) =>
      envValues.FILE_DRIVER === FileDriver.S3,
  )
  @IsString()
  @IsOptional()
  AWS_DEFAULT_S3_URL: string;

  @ValidateIf(
    (envValues: EnvironmentVariablesValidator) =>
      envValues.FILE_DRIVER === FileDriver.S3,
  )
  @IsString()
  AWS_S3_REGION: string;
}

export default registerAs<FileConfig>('file', () => {
  const validatedEnv = validateConfig(
    process.env,
    EnvironmentVariablesValidator,
  );
  return {
    driver: validatedEnv.FILE_DRIVER ?? 'local',
    accessKeyId: validatedEnv.ACCESS_KEY_ID,
    secretAccessKey: validatedEnv.SECRET_ACCESS_KEY,
    awsDefaultS3Bucket: validatedEnv.AWS_DEFAULT_S3_BUCKET,
    awsDefaultS3Url: validatedEnv.AWS_DEFAULT_S3_URL,
    awsS3Region: validatedEnv.AWS_S3_REGION,
    maxFileSize: 5242880,
    downloadUrlExpire: 86400,
  };
});

export function getS3Configuration(): S3ClientConfig {
  return {
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId: process.env.ACCESS_KEY_ID,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
    },
  };
}

export function getSESConfiguration(): SESClientConfig {
  return {
    apiVersion: '2010-12-01',
    credentials: {
      accessKeyId: process.env.MAIL_USER,
      secretAccessKey: process.env.MAIL_PASSWORD,
    },
    region: process.env.MAIL_SERVER_REGION,
  };
}
