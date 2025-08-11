import { Module } from '@nestjs/common';
import { GeoFencingController } from './geo-fencing.controller';
import { GeoFencingService } from './geo-fencing.service';

@Module({
  controllers: [GeoFencingController],
  providers: [GeoFencingService]
})
export class GeoFencingModule {}
