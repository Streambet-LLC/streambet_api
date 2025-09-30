import {
  CompleteMultipartUploadCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from 'src/common/types/config.type';
import { getS3Configuration } from 'src/config/file.config';
import { v4 as uuid } from 'uuid';
interface UploadedFile {
  originalname: string;
  mimetype: string;
}
/**
 * Includes methods for ease of Aws Access & Configuration
 * from the environment variables
 */

@Injectable()
export class SharedAwsmethodsService {
  private readonly logger = new Logger(SharedAwsmethodsService.name);

  constructor(private readonly configService: ConfigService<AllConfigType>) {}
  private readonly S3ClientInstance = new S3Client(getS3Configuration());

  /**
   * Returns S3 bucket name
   * @function getPublicS3Bucket
   * @returns S3 Bucket Name
   */
  getPublicS3Bucket() {
    return this.configService.getOrThrow('file.awsDefaultS3Bucket', {
      infer: true,
    });
  }

  /**
   * Returns S3Bucket name
   * @function getPrivateS3Bucket
   * @returns Public S3 bucket name
   */
  getPrivateS3Bucket() {
    return this.configService.getOrThrow('file.awsDefaultS3Bucket', {
      infer: true,
    });
  }

  /**
   * @function uploadPublicFile
   *
   * This function is used to upload image to S3 bucket.
   * Here using upload method to upload image into s3 Bucket.
   * Upload method parameter are BucketName,DataBuffer and key.
   * This function is used to insert all the information into public file table and return that informations
   *
   * @param dataBuffer Buffer
   * @param file The file holds filename,original name,encoding,mimetype and Buffer information
   * @param bucket Bucket is the Bucket Name
   * @param type Profile
   * @returns  All details of Inserted data
   */
  async uploadPublicFile(
    dataBuffer: Buffer,
    file: UploadedFile,
    bucket = '',
    type = 'image',
  ) {
    const UID = uuid();
    try {
      // Creating a multipart-upload command which has additional params
      // to retry if it fails for N times, chunk parallel uploads and
      // returning the key and URL. Use `PutObjectCommand` if access to
      // the URL is not required and has custom function to generate it
      const uploadRequest = new Upload({
        client: this.S3ClientInstance,
        params: {
          Bucket: bucket || this.getPublicS3Bucket(),
          Key: `${type}/${UID}-${file.originalname}`,
          ACL: 'public-read',
          Body: dataBuffer,
          ContentType: file.mimetype,
        },
      });
      // NOTE: Keep the types and avoid infered types.
      // The SDK's typescript generation requires explicit
      // type definitions of completion or error scenario.
      const uploadResult: CompleteMultipartUploadCommandOutput =
        await uploadRequest.done();
      return uploadResult;
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
}
