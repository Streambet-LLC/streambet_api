import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Message } from './entities/message.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { UserBlock } from './entities/user-block.entity';
import { User } from '../users/entities/user.entity';
import { InboxService } from './inbox.service';
import { QueueModule } from '../queue/queue.module';
import { SharedAwsmethodsModule } from '../awsmethods/awsmethos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationParticipant,
      Message,
      MessageAttachment,
      UserBlock,
      User,
    ]),
    forwardRef(() => QueueModule),
    SharedAwsmethodsModule,
  ],
  controllers: [],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
