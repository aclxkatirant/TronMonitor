import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { APP_VERSION } from '../version';

@ApiTags('Sağlık')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Servis sağlık durumu (veritabanı ve Redis)' })
  async check() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.redis.ping()]);
    const body = {
      status: database && redis ? 'ok' : 'degraded',
      version: APP_VERSION,
      checks: {
        database: database ? 'ok' : 'error',
        redis: redis ? 'ok' : 'error',
      },
      timestamp: new Date().toISOString(),
    };
    if (body.status !== 'ok') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
