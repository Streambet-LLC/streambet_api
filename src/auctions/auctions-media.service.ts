import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from '@nestjs/config';
import { createReadStream, promises as fs } from 'fs';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { getS3Configuration } from '../config/file.config';
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

/**
 * Admin uploads for Hermes auction photos and videos. Multer spools the
 * file to disk (videos can be hundreds of MB) and it is streamed to S3 with
 * a multipart upload, so nothing large is held in memory.
 */
@Injectable()
export class AuctionsMediaService {
  private readonly logger = new Logger(AuctionsMediaService.name);
  private readonly s3 = new S3Client(getS3Configuration());

  constructor(private readonly config: ConfigService<AllConfigType>) {}

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
      const key = `hermes/${kind}s/${uuid()}${ext || extname(file.originalname)}`;
      const result = await new Upload({
        client: this.s3,
        params: {
          Bucket: this.config.getOrThrow('file.awsDefaultS3Bucket', {
            infer: true,
          }),
          Key: key,
          ACL: 'public-read',
          Body: createReadStream(file.path),
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        },
        queueSize: 4,
        partSize: 10 * 1024 * 1024,
      }).done();
      return { key, url: result.Location, kind };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `Hermes ${kind} upload failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Upload failed. Please try again.');
    } finally {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }
}
