import { Module } from '@nestjs/common';
import { EmailsController } from './email.controller';
import { EmailsService } from './email.service';

@Module({
  controllers: [EmailsController],
  providers: [EmailsService],
  exports: [EmailsService],
})
export class EmailsModule {}
