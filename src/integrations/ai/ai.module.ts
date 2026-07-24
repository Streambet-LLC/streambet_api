import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { ClaudeUsageService } from './claude-usage.service';
import { ClaudeUsageLog } from './entities/claude-usage-log.entity';

/**
 * Global so any module (analytics intelligence, reconciliation, etc.) can
 * inject `AiService` without re-importing. Reads `ANTHROPIC_API_KEY` from the
 * already-global ConfigModule. Also owns the Claude usage log + service so
 * every AI call is metered in one place.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ClaudeUsageLog])],
  providers: [AiService, ClaudeUsageService],
  exports: [AiService, ClaudeUsageService],
})
export class AiModule {}
