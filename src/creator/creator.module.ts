import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CreatorService } from './creator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User]), UsersModule],
  controllers: [],
  providers: [CreatorService],
  exports: [CreatorService],
})
export class CreatorModule {}
