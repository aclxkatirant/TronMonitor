import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { MetricsQueryDto } from './dto/metrics.dto';
import { MetricsService } from './metrics.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Metrikler')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('servers/:id/metrics')
  @RequirePermissions(PERMISSIONS.METRICS_READ)
  @ApiOperation({ summary: 'CPU, bellek, ağ, disk G/Ç ve yük ortalaması geçmişi (zaman aralığına göre özetlenmiş)' })
  history(@Param('id', uuid()) id: string, @Query() query: MetricsQueryDto) {
    return this.metrics.history(id, query);
  }

  @Get('servers/:id/metrics/volumes')
  @RequirePermissions(PERMISSIONS.METRICS_READ)
  @ApiOperation({ summary: 'Hacim bazında disk kullanım geçmişi' })
  volumes(@Param('id', uuid()) id: string, @Query() query: MetricsQueryDto) {
    return this.metrics.volumeHistory(id, query);
  }

  @Get('servers/:id/metrics/interfaces')
  @RequirePermissions(PERMISSIONS.METRICS_READ)
  @ApiOperation({ summary: 'Arayüz bazında ağ trafiği geçmişi' })
  interfaces(@Param('id', uuid()) id: string, @Query() query: MetricsQueryDto) {
    return this.metrics.interfaceHistory(id, query);
  }

  @Get('metrics/top')
  @RequirePermissions(PERMISSIONS.METRICS_READ)
  @ApiOperation({ summary: 'En yoğun sunucular (son örneklere göre)' })
  top() {
    return this.metrics.topServers();
  }
}
