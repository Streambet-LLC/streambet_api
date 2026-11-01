import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/guards/admin-role.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { AuctionCategory } from '../prize/enums/auction-category.enum';
import { AuctionsService } from './auctions.service';
import {
  AuctionsMediaService,
  VIDEO_MAX_BYTES,
} from './auctions-media.service';
import { AuctionsEstimateService } from './auctions-estimate.service';
import {
  CreateAuctionDto,
  EstimateValueDto,
  MarkShippedDto,
  UpdateAuctionDto,
} from './dto/create-auction.dto';
import type { AuctionBucket } from './hermes.types';

interface RequestWithUser extends Request {
  user: User;
}

class ValueSubjectDto {
  @IsEnum(AuctionCategory)
  category: AuctionCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  subject: string;
}

/** Hermes Auctions admin (house) routes. Every handler checks the role. */
@ApiTags('hermes-auctions-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin/auctions')
export class AdminAuctionsController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly media: AuctionsMediaService,
    private readonly estimate: AuctionsEstimateService,
  ) {}

  private ensureAdmin(user: User) {
    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admins only.');
    }
  }

  @Get()
  async list(
    @Request() req: RequestWithUser,
    @Query('bucket') bucket = 'live',
  ) {
    this.ensureAdmin(req.user);
    if (!['live', 'upcoming', 'settled'].includes(bucket)) {
      throw new BadRequestException('bucket must be live, upcoming or settled');
    }
    return { data: await this.auctions.listAdmin(bucket as AuctionBucket) };
  }

  @Post()
  async create(@Request() req: RequestWithUser, @Body() dto: CreateAuctionDto) {
    this.ensureAdmin(req.user);
    const a = await this.auctions.createAuction(req.user.id, dto);
    return { data: await this.auctions.getAdminDetail(a.id) };
  }

  @HttpCode(200)
  @Post('media/:kind')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: VIDEO_MAX_BYTES, files: 1 },
    }),
  )
  async upload(
    @Request() req: RequestWithUser,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.ensureAdmin(req.user);
    if (kind !== 'image' && kind !== 'video') {
      throw new BadRequestException('kind must be image or video');
    }
    return { data: await this.media.upload(kind, file) };
  }

  @HttpCode(200)
  @Post('estimate/identify')
  async identify(
    @Request() req: RequestWithUser,
    @Body() dto: EstimateValueDto,
  ) {
    this.ensureAdmin(req.user);
    return {
      data: await this.estimate.identify({ ...dto, adminId: req.user.id }),
    };
  }

  @HttpCode(200)
  @Post('estimate/value')
  async value(@Request() req: RequestWithUser, @Body() dto: ValueSubjectDto) {
    this.ensureAdmin(req.user);
    return {
      data: await this.estimate.value({ ...dto, adminId: req.user.id }),
    };
  }

  @Get(':id')
  async detail(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.ensureAdmin(req.user);
    return { data: await this.auctions.getAdminDetail(id) };
  }

  @Patch(':id')
  async update(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAuctionDto,
  ) {
    this.ensureAdmin(req.user);
    await this.auctions.updateAuction(req.user.id, id, dto);
    return { data: await this.auctions.getAdminDetail(id) };
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.ensureAdmin(req.user);
    await this.auctions.cancelAuction(req.user.id, id);
    return { data: await this.auctions.getAdminDetail(id) };
  }

  @HttpCode(200)
  @Post(':id/force-close')
  async forceClose(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.ensureAdmin(req.user);
    await this.auctions.forceClose(req.user.id, id);
    return { data: await this.auctions.getAdminDetail(id) };
  }

  @HttpCode(200)
  @Post(':id/ship')
  async ship(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkShippedDto,
  ) {
    this.ensureAdmin(req.user);
    await this.auctions.markShipped(id, dto);
    return { data: await this.auctions.getAdminDetail(id) };
  }
}
