import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { AgentDownloadsService } from './agent-downloads.service';

/**
 * Ajan ikili dosyaları, özet dosyası ve kurulum betikleri. Bu dosyalar gizli değildir; kurulum komutları
 * bunları kimlik doğrulaması olmadan indirir ve SHA256SUMS ile doğrular.
 */
@ApiTags('Ajan indirmeleri')
@Controller('agent-downloads')
export class AgentDownloadsController {
  constructor(private readonly downloads: AgentDownloadsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Sunulan ajan dosyaları ve özetleri' })
  list() {
    return this.downloads.list();
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':file')
  @ApiOperation({ summary: 'Ajan dosyasını indir' })
  async download(@Param('file') file: string, @Res() response: Response): Promise<void> {
    const resolved = await this.downloads.resolve(file);
    response.setHeader('Content-Type', resolved.contentType);
    response.setHeader('Content-Length', String(resolved.size));
    response.setHeader('Content-Disposition', `attachment; filename="${resolved.name}"`);
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(resolved.path);
  }
}
