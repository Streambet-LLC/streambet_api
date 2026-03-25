import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InboxService } from './inbox.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  ListConversationsDto,
  ListMessagesDto,
} from './dto/list-conversations.dto';
import { UpdateInboxSettingsDto } from './dto/update-inbox-settings.dto';
import { SharedAwsmethodsService } from '../awsmethods/awsmethods.service';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

@ApiTags('Inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inboxService: InboxService,
    private readonly awsService: SharedAwsmethodsService,
  ) {}

  // ─── CONVERSATIONS ─────────────────────────────────────────────────

  @Post('conversations')
  async createConversation(
    @Request() req,
    @Body() dto: CreateConversationDto,
  ) {
    return this.inboxService.createConversation(req.user.id, dto);
  }

  @Get('conversations')
  async listConversations(
    @Request() req,
    @Query() dto: ListConversationsDto,
  ) {
    return this.inboxService.listConversations(req.user.id, dto);
  }

  @Get('conversations/:id')
  async getConversationMessages(
    @Request() req,
    @Param('id') conversationId: string,
    @Query() dto: ListMessagesDto,
  ) {
    return this.inboxService.getConversationMessages(
      req.user.id,
      conversationId,
      dto,
    );
  }

  // ─── MESSAGES ─────────────────────────────────────────────────────────

  @Post('conversations/:id/messages')
  async sendMessage(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.inboxService.sendMessage(req.user.id, conversationId, dto);
  }

  @Post('conversations/:id/read')
  async markAsRead(
    @Request() req,
    @Param('id') conversationId: string,
  ) {
    return this.inboxService.markConversationAsRead(
      req.user.id,
      conversationId,
    );
  }

  // ─── UNREAD COUNT ──────────────────────────────────────────────────────

  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    return this.inboxService.getUnreadCount(req.user.id);
  }

  // ─── BLOCK / UNBLOCK ──────────────────────────────────────────────────

  @Post('block/:userId')
  async blockUser(@Request() req, @Param('userId') blockedUserId: string) {
    return this.inboxService.blockUser(req.user.id, blockedUserId);
  }

  @Delete('block/:userId')
  async unblockUser(@Request() req, @Param('userId') blockedUserId: string) {
    return this.inboxService.unblockUser(req.user.id, blockedUserId);
  }

  // ─── SETTINGS ──────────────────────────────────────────────────────────

  @Get('settings')
  async getSettings(@Request() req) {
    return this.inboxService.getInboxSettings(req.user.id);
  }

  @Patch('settings')
  async updateSettings(
    @Request() req,
    @Body() dto: UpdateInboxSettingsDto,
  ) {
    return this.inboxService.updateInboxSettings(req.user.id, dto);
  }

  // ─── FILE UPLOAD ───────────────────────────────────────────────────────

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, callback) => {
        const allowedMimes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ];
        if (!allowedMimes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              'Only JPEG, PNG, WebP, and GIF images are allowed',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.awsService.uploadPublicFile(
      file.buffer,
      file,
      '',
      'inbox',
    );

    return {
      fileUrl: result.Location,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    };
  }
}
