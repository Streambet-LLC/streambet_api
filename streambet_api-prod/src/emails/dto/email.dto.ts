import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { transformFilterParam } from 'src/common/filters/filter.dto';
import { EmailType } from 'src/enums/email-type.enum';

export class EmailTypeDto {
  @ApiProperty({
    enum: Object.values(EmailType),
    description:
      'Defined the email type this key will select the tempalte and schema',
  })
  @IsString()
  @IsIn(Object.values(EmailType))
  emailType: string;
}

export class EmailPayloadDto {
  @ApiProperty({
    isArray: true,
    description: 'Comma-separated list of TO address',
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Transform(transformFilterParam, { toClassOnly: true })
  public toAddress: string[];

  @ApiProperty({ type: 'string', description: 'Subject of email' })
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  subject: string;

  // @ApiPropertyOptional({
  //     type: 'string',
  //     description: 'body Content for email',
  //     required: false,
  // })
  // @IsString()
  // @IsOptional()
  // bodyContent: string;

  @ApiProperty({
    isArray: true,
    description: 'Comma-separated list of cc',
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(transformFilterParam, { toClassOnly: true })
  public cc?: string[];

  // @ApiPropertyOptional({
  //     type: 'string',
  //     description: 'Attachment for email',
  //     required: false,
  // })
  // @IsOptional()
  // attachments: string;

  @ApiProperty({
    isArray: true,
    description: 'Comma-separated list of bcc',
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(transformFilterParam, { toClassOnly: true })
  public bcc?: string[];

  @ApiProperty({
    type: 'string',
    format: 'email',
    required: true,
    description: 'User email',
  })
  @IsOptional()
  @IsString()
  @IsEmail()
  public fromAddress?: string;

  params: any;
}

export class EmailOkResponseDto {
  @ApiProperty({ type: 'string', description: 'Response message of email' })
  @IsString()
  message: any;
}
