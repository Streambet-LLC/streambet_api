import { Module } from '@nestjs/common';
import { N8nIntegrationService } from './n8n-integration.service';
import { N8nNotificationService } from './n8n-notification.service';
import { UsersModule } from '../../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [N8nIntegrationService, N8nNotificationService],
  exports: [N8nIntegrationService],
})
export class N8nIntegrationModule {}
