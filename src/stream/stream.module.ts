import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './entities/stream.entity';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { WalletsService } from 'src/wallets/wallets.service';
import { WalletsModule } from 'src/wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([Stream]), WalletsModule],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
