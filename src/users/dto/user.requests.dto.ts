import {
  IsString,
  MinLength,
  Matches,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Transform, TransformFnParams } from 'class-transformer';
import { AdminFilterDto, Range, Sort } from 'src/common/filters/filter.dto';

export class UserIdDto {
  @ApiProperty({
    description: 'Id of the user',
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class ProfileUpdateDto {
  @ApiProperty({
    description: 'Name of the user',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'City of the user',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({
    description: 'State of the user',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({
    description: 'Username of the user',
    example: 'johndoe',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Username can only contain alphanumeric characters, underscores, and hyphens',
  })
  username?: string;

  @ApiProperty({
    description: 'Old password for the account',
    example: 'StrongP@ss123',
    minLength: 8,
  })
  @IsString()
  @IsOptional()
  @MinLength(8, {
    message: 'Old password must be at least 8 characters long',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Old password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
  })
  currentPassword?: string;

  @ApiProperty({
    description: 'New password for the account',
    example: 'StrongP@ss123',
    minLength: 8,
  })
  @IsString()
  @IsOptional()
  @MinLength(8, {
    message: 'New password must be at least 8 characters long',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'New password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
  })
  newPassword?: string;

  @ApiProperty({
    description: 'Profile url of the user',
  })
  @IsOptional()
  @IsString()
  profileImageUrl?: string;

  @Exclude()
  @IsOptional()
  password?: string;
}

export class PaginationFilterDto {
  @ApiProperty({
    required: false,
    default: '[0,24]',
    description: 'Number of records eg: [0,24]',
  })
  @Transform(
    ({ value }: TransformFnParams): Range =>
      typeof value === 'string'
        ? (JSON.parse(value) as Range)
        : (value as Range),
  )
  @IsArray()
  @IsOptional()
  public range?: Range;

  @ApiProperty({
    required: false,
    default: '["created_at","DESC"]',
    description: 'Sort order for the list, eg: ["created_at","DESC"]',
  })
  @Transform(
    ({ value }: TransformFnParams): Sort =>
      value && (JSON.parse(value) as Sort),
  )
  @IsArray()
  @IsOptional()
  public sort?: Sort;
}

export class UserFilterDto extends AdminFilterDto {
  @ApiProperty({
    description: `
  Filter params pass the data as key value pair
  eg:
  {
    "q": <search_string>first_name,last_name,
   
  }
  `,
    required: false,
    default: '{}',
  })
  @IsString()
  public filter: string;

  @ApiPropertyOptional({
    type: String,
    default: true,
    description:
      'Pass with parameter false if you want the results without pagination',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) =>
    value && value === 'false' ? false : true,
  )
  pagination?: boolean;
}
export class UserUpdateDto {
  @ApiProperty({
    description: 'User Id of the user',
  })
  @IsDefined()
  @IsNotEmpty()
  @IsEnum([true, false])
  @IsBoolean()
  userStatus: boolean;

  @ApiProperty({
    description: 'Pass true for activate and false for deactivate user ',
  })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  userId: string;
}

export class NotificationSettingsUpdateDto {
  @ApiProperty({
    description: 'Enable or disable email notifications',
    example: true,
    required: true,
  })
  @IsDefined()
  @IsBoolean()
  emailNotification: boolean;

  @ApiProperty({
    description: 'Enable or disable in-app notifications',
    example: false,
    required: true,
  })
  @IsDefined()
  @IsBoolean()
  inAppNotification: boolean;
}