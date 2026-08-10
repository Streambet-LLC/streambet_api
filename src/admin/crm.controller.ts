import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { ApiResponse } from '../common/types/api-response.interface';
import { CrmService, CreateContactInput } from './crm.service';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * CRM manual layer — buyer/seller contacts, note timelines, and lead conversion.
 * The auto-discovered leads pool + seller inventory live under
 * /admin/analytics/acquisition and /admin/analytics/sellers respectively.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/analytics/crm')
@UseGuards(JwtAuthGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @ApiOperation({ summary: 'List CRM contacts (buyers / sellers)' })
  @Get('contacts')
  async listContacts(
    @Request() req: RequestWithUser,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('stage') stage?: string,
    @Query('preferred') preferred?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.listContacts({
      kind,
      search,
      stage,
      preferred: preferred === 'true' || preferred === '1',
    });
    return { status: HttpStatus.OK, message: 'Contacts fetched successfully', data };
  }

  @ApiOperation({ summary: 'CRM contact counts (buyers / sellers / preferred)' })
  @Get('stats')
  async stats(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.stats();
    return { status: HttpStatus.OK, message: 'CRM stats fetched successfully', data };
  }

  @ApiOperation({ summary: 'Create a CRM contact' })
  @Post('contacts')
  async createContact(
    @Request() req: RequestWithUser,
    @Body() body: CreateContactInput,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.createContact(body, req.user.id);
    return { status: HttpStatus.CREATED, message: 'Contact created successfully', data };
  }

  @ApiOperation({ summary: 'Update a CRM contact' })
  @Patch('contacts/:id')
  async updateContact(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: Partial<CreateContactInput>,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.updateContact(id, body);
    return { status: HttpStatus.OK, message: 'Contact updated successfully', data };
  }

  @ApiOperation({ summary: 'Delete a CRM contact' })
  @Delete('contacts/:id')
  async deleteContact(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.deleteContact(id);
    return { status: HttpStatus.OK, message: 'Contact deleted successfully', data };
  }

  @ApiOperation({ summary: 'List notes for a contact or a lead' })
  @Get('notes')
  async listNotes(
    @Request() req: RequestWithUser,
    @Query('contactId') contactId?: string,
    @Query('leadId') leadId?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.listNotes({ contactId, leadId });
    return { status: HttpStatus.OK, message: 'Notes fetched successfully', data };
  }

  @ApiOperation({ summary: 'Add a note to a contact or a lead' })
  @Post('notes')
  async addNote(
    @Request() req: RequestWithUser,
    @Body() body: { contactId?: string; leadId?: string; body: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.addNote(body, req.user.id);
    return { status: HttpStatus.CREATED, message: 'Note added successfully', data };
  }

  @ApiOperation({ summary: 'Delete a note' })
  @Delete('notes/:id')
  async deleteNote(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.crm.deleteNote(id);
    return { status: HttpStatus.OK, message: 'Note deleted successfully', data };
  }

  @ApiOperation({ summary: 'Convert a discovered lead into a CRM contact' })
  @Post('leads/:id/convert')
  async convertLead(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { kind?: 'buyer' | 'seller' },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const kind = body?.kind === 'seller' ? 'seller' : 'buyer';
    const data = await this.crm.convertLead(id, kind, req.user.id);
    return { status: HttpStatus.OK, message: 'Lead converted successfully', data };
  }
}
