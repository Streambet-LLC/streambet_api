import { Module } from '@nestjs/common';
import { GeoFencingService } from './geo-fencing.service';
import { GeoFencingGuard } from './geo-fencing.guard';
import { GeoFencingSocketGuard } from './geo-fencing-socket.guard';

@Module({
  controllers: [],
  providers: [GeoFencingService, GeoFencingGuard, GeoFencingSocketGuard],
  exports: [GeoFencingService, GeoFencingGuard, GeoFencingSocketGuard],
})
export class GeoFencingModule {}
