import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CreatorController } from './creator.controller';
import { CreatorService } from './creator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreatorApplication } from './entities/creator-application.entity';
import { User } from 'src/users/entities/user.entity';
import { EmailsModule } from 'src/emails/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, CreatorApplication]),
    UsersModule,
    EmailsModule,
  ],
  controllers: [CreatorController],
  providers: [CreatorService],
  exports: [CreatorService],
})
export class CreatorModule {}
