import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InboxService } from './inbox.service';
import {
  AdminListConversationsDto,
  AdminSendMessageDto,
} from './dto/admin-inbox.dto';
import { ListMessagesDto } from './dto/list-conversations.dto';
import { UserRole } from '../enums/user-role.enum';

@ApiTags('Admin Inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/inbox')
export class AdminInboxController {
  constructor(private readonly inboxService: InboxService) {}

  private ensureAdmin(user: any) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Get('conversations')
  async listConversations(
    @Request() req,
    @Query() dto: AdminListConversationsDto,
  ) {
    this.ensureAdmin(req.user);
    return this.inboxService.adminListConversations(dto);
  }

  @Get('conversations/:id')
  async getConversationMessages(
    @Request() req,
    @Param('id') conversationId: string,
    @Query() dto: ListMessagesDto,
  ) {
    this.ensureAdmin(req.user);
    return this.inboxService.adminGetConversationMessages(conversationId, dto);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: AdminSendMessageDto,
  ) {
    this.ensureAdmin(req.user);
    return this.inboxService.adminSendMessage(
      req.user.id,
      conversationId,
      dto.content,
    );
  }
}
