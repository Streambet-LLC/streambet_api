import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './entities/stream.entity';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { WalletsModule } from 'src/wallets/wallets.module';
import { BettingModule } from 'src/betting/betting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stream]),
    WalletsModule,
    forwardRef(() => BettingModule),
  ],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
