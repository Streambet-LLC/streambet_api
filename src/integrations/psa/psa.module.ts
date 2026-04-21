import { Module } from '@nestjs/common';
import { PsaController } from './psa.controller';
import { PsaService } from './psa.service';
import { EmailsModule } from '../../emails/email.module';

@Module({
  imports: [EmailsModule],
  controllers: [PsaController],
  providers: [PsaService],
  exports: [PsaService],
})
export class PsaModule {}