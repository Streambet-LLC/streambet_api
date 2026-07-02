import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * Global so any module (analytics intelligence, reconciliation, etc.) can
 * inject `AiService` without re-importing. Reads `ANTHROPIC_API_KEY` from the
 * already-global ConfigModule.
 */
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
