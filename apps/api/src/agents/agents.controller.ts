import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public, clientIp } from '../auth/decorators';
import { AgentAuthGuard, type AgentRequest } from './agent-auth.guard';
import { AgentsService } from './agents.service';
import { HeartbeatDto, MetricsBatchDto, RegisterAgentDto } from './dto/agent.dto';

@ApiTags('Ajan iletişimi')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Kayıt belirtecini ajan kimlik bilgisiyle takas et (tek kullanımlık)' })
  register(@Body() dto: RegisterAgentDto, @Req() request: Request) {
    return this.agents.register(dto, clientIp(request));
  }

  @Public()
  @UseGuards(AgentAuthGuard)
  @Post('heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ajan heartbeat (HMAC imzalı)' })
  heartbeat(@Body() dto: HeartbeatDto, @Req() request: AgentRequest) {
    return this.agents.heartbeat(request.agent!, dto, clientIp(request));
  }

  @Public()
  @UseGuards(AgentAuthGuard)
  @Post('metrics')
  @HttpCode(200)
  @ApiOperation({ summary: 'Metrik örneklerini gönder (HMAC imzalı, toplu)' })
  metrics(@Body() dto: MetricsBatchDto, @Req() request: AgentRequest) {
    return this.agents.ingestMetrics(request.agent!, dto);
  }
}
