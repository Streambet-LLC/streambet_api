import { Module } from '@nestjs/common';

import { PsaService } from './psa.service';
import { EmailsModule } from '../../emails/email.module';

@Module({
  imports: [EmailsModule],
  controllers: [],
  providers: [PsaService],
  exports: [PsaService],
})
export class PsaModule {}
