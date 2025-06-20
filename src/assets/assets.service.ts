import { BadRequestException, Injectable } from '@nestjs/common';
import { SharedAwsmethodsService } from 'src/awsmethods/awsmethods.service';
@Injectable()
export class AssetsService {
  constructor(private readonly awsmethodsService: SharedAwsmethodsService) {}

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
    file,
    bucket = '',
    type = 'image',
  ) {
    try {
      const uploadResult = await this.awsmethodsService.uploadPublicFile(
        dataBuffer,
        file,
        bucket,
        type,
      );
      return uploadResult;
    } catch (e) {
      throw new BadRequestException(
        `Error while uploading file: ${e.message}`,
        e,
      );
    }
  }
}
