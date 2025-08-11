import { Module } from '@nestjs/common';
import { GeoFencingService } from './geo-fencing.service';

@Module({
  controllers: [],
  providers: [GeoFencingService],
  exports: [GeoFencingService],
})
export class GeoFencingModule {}
