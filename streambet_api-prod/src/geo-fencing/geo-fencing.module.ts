import { Module } from '@nestjs/common';
import { GeoFencingService } from './geo-fencing.service';
import { GeoFencingGuard } from './geo-fencing.guard';

@Module({
  controllers: [],
  providers: [GeoFencingService, GeoFencingGuard],
  exports: [GeoFencingService, GeoFencingGuard],
})
export class GeoFencingModule {}
