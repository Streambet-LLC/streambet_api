import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from '@nestjs/config';
import { createReadStream, promises as fs } from 'fs';
import { v4 as uuid } from 'uuid';
import { AllConfigType } from '../common/types/config.type';

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

/** S3 errors an admin can act on, mapped to plain-English messages. */
const S3_ERROR_HINT: Record<string, string> = {
  InvalidAccessKeyId:
    "Storage isn't configured: the server's AWS access key (ACCESS_KEY_ID) no longer exists. Replace it in the environment and redeploy.",
  SignatureDoesNotMatch:
    "Storage isn't configured: the server's AWS secret key (SECRET_ACCESS_KEY) is wrong. Replace it and redeploy.",
  ExpiredToken:
    "Storage isn't configured: the server's AWS credentials have expired.",
  CredentialsProviderError:
    "Storage isn't configured: no AWS credentials are available to the server.",
  AccessDenied:
    "The server's AWS key isn't allowed to write to the media bucket {bucket} (its IAM policy needs s3:PutObject on arn:aws:s3:::{bucket}/*).",
  NoSuchBucket:
    "The media bucket {bucket} (AWS_DEFAULT_S3_BUCKET) doesn't exist.",
  AllAccessDisabled:
    'The media bucket {bucket} (AWS_DEFAULT_S3_BUCKET) is disabled. Point AWS_DEFAULT_S3_BUCKET at an active bucket and redeploy.',
};

/** Errors where the bucket may just be refusing the public-read ACL. */
const RETRY_WITHOUT_ACL = new Set([
  'AccessControlListNotSupported',
  'AccessDenied',
]);

function s3ErrorCode(err: unknown): string {
  const e = err as { name?: string; Code?: string };
  return e?.Code || e?.name || 'Unknown';
}

/**
 * Admin uploads for Hermes auction photos and videos. Multer spools the
 * file to disk (videos can be hundreds of MB) and it is streamed to S3 with
 * a multipart upload, so nothing large is held in memory.
 *
 * Uses the explicit ACCESS_KEY_ID / SECRET_ACCESS_KEY when set, otherwise
 * the default AWS credential chain (e.g. an ECS task role). Objects are
 * uploaded public-read. If the bucket refuses the ACL (ACLs disabled, or
 * Block Public Access rejecting public ACLs with AccessDenied) it retries
 * once without it; public access then comes from the bucket policy.
 */
@Injectable()
export class AuctionsMediaService {
  private readonly logger = new Logger(AuctionsMediaService.name);
  private readonly s3: S3Client;

  constructor(private readonly config: ConfigService<AllConfigType>) {
    const accessKeyId = process.env.ACCESS_KEY_ID;
    const secretAccessKey = process.env.SECRET_ACCESS_KEY;
    this.s3 = new S3Client({
      region: process.env.AWS_S3_REGION,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }

  private async put(params: {
    key: string;
    path: string;
    contentType: string;
    acl: boolean;
  }): Promise<string> {
    const result = await new Upload({
      client: this.s3,
      params: {
        Bucket: this.config.getOrThrow('file.awsDefaultS3Bucket', {
          infer: true,
        }),
        Key: params.key,
        ...(params.acl ? { ACL: 'public-read' as const } : {}),
        Body: createReadStream(params.path),
        ContentType: params.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
    }).done();
    return result.Location;
  }

  async upload(
    kind: 'image' | 'video',
    file: Express.Multer.File | undefined,
  ): Promise<{ key: string; url: string; kind: 'image' | 'video' }> {
    if (!file) throw new BadRequestException('No file received.');
    try {
      const types = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES;
      const ext = types[file.mimetype];
      if (!ext) {
        throw new BadRequestException(
          kind === 'image'
            ? 'Photos must be JPG, PNG or WebP.'
            : 'Videos must be MP4, MOV or WebM.',
        );
      }
      const max = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
      if (file.size > max) {
        throw new BadRequestException(
          `File is too large (max ${Math.round(max / 1024 / 1024)} MB).`,
        );
      }
      const key = `hermes/${kind}s/${uuid()}${ext}`;
      const args = { key, path: file.path, contentType: file.mimetype };
      let url: string;
      try {
        url = await this.put({ ...args, acl: true });
      } catch (err) {
        const code = s3ErrorCode(err);
        if (!RETRY_WITHOUT_ACL.has(code)) throw err;
        this.logger.warn(
          `Hermes ${kind} upload: bucket refused public-read ACL [${code}]; retrying without it`,
        );
        url = await this.put({ ...args, acl: false });
      }
      return { key, url, kind };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const code = s3ErrorCode(err);
      this.logger.error(
        `Hermes ${kind} upload failed [${code}]: ${(err as Error).message}`,
      );
      const bucket = String(
        this.config.get('file.awsDefaultS3Bucket', { infer: true }) ??
          '(unset)',
      );
      const hint = S3_ERROR_HINT[code]?.split('{bucket}').join(bucket);
      throw new BadRequestException(
        hint ?? `Upload failed (${code}). Please try again.`,
      );
    } finally {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }
}
