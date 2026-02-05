import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follower } from './follower.entity';
import { FollowerService } from './follower.service';

@Module({
  imports: [TypeOrmModule.forFeature([Follower])],
  providers: [FollowerService],
  exports: [Follower],
})
export class FollowerModule {}
