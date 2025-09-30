import { Module } from '@nestjs/common';
import { SharedAwsmethodsService } from './awsmethods.service';

@Module({
  imports: [],
  controllers: [],
  providers: [SharedAwsmethodsService],
  exports: [SharedAwsmethodsService],
})
export class SharedAwsmethodsModule {}
