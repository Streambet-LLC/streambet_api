import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { User } from '../../users/entities/user.entity';
import {
  PsaImportRequestDto,
  PsaImportResponseDto,
} from './dto/psa-import.dto';
import { PsaService } from './psa.service';
import { UserRole } from 'src/enums/user-role.enum';

interface RequestWithUser {
  user: User;
}

@ApiTags('psa')
@ApiBearerAuth()
@Controller('seller/prizes/psa')
@UseGuards(JwtAuthGuard)
export class PsaController {
  constructor(private readonly psaService: PsaService) {}

  private ensureSellerOrAdmin(user: User): void {
    if (!user.isSeller && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Seller access required');
    }
  }

  @Post('import-cert')
  @ApiOperation({
    summary: 'Import PSA cert data and images for item autofill',
  })
  @ApiResponse({ status: 201, type: PsaImportResponseDto })
  async importCert(
    @Request() req: RequestWithUser,
    @Body() dto: PsaImportRequestDto,
  ): Promise<PsaImportResponseDto> {
    this.ensureSellerOrAdmin(req.user);
    return this.psaService.importCertification(dto.certNumber);
  }
}
