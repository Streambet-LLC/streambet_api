import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('coin-package')
@Controller('coin-package')
export class CoinPackageController {
  constructor(private readonly coinPackageService: CoinPackageService) {}

  @Get()
  findAll() {
    return this.coinPackageService.findAll();
  }
}
