import { Global, Module } from '@nestjs/common';
import { MixpanelService } from './mixpanel.service';

/**
 * Global so any feature service can inject MixpanelService without wiring
 * imports/exports per module. Reads config from the global ConfigModule.
 */
@Global()
@Module({
  providers: [MixpanelService],
  exports: [MixpanelService],
})
export class MixpanelModule {}
