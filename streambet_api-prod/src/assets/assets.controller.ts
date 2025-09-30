import {
  BadRequestException,
  Controller,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { AllowedDocs, AllowedImages } from 'src/common/types/media-files.types';
import { Express, Request } from 'express';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @ApiOperation({
    tags: ['Assets Upload'],
    summary: 'Upload image or document files',
    description: `API to upload images with public access. 'type' is the subdirectory. 'fileType' ("image" or "document") is the type of file. Pass in multi-part formdata with key "file"`,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiConsumes('multipart/form-data')
  @Post('file/upload/:fileType/:type')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (
        req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const fileType = req.params.fileType;
        if (
          (fileType === 'image' && file.mimetype in AllowedImages) ||
          (fileType === 'document' &&
            (file.mimetype in AllowedDocs || file.mimetype in AllowedImages))
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Please check the file type'), false);
        }
      },
    }),
  )
  async addFiles(
    @UploadedFile() file: Express.Multer.File, // safer than 'any'
    @Param('fileType') fileType: string,
    @Param('type') type: string,
  ) {
    const photo = await this.assetsService.uploadPublicFile(
      file.buffer,
      file,
      '',
      type,
    );
    return {
      message: 'File upload successful',
      statusCode: HttpStatus.OK,
      data: photo,
    };
  }
}
