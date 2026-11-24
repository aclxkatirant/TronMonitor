import { Module } from '@nestjs/common';
import { AgentDownloadsController } from './agent-downloads.controller';
import { AgentDownloadsService } from './agent-downloads.service';

@Module({
  controllers: [AgentDownloadsController],
  providers: [AgentDownloadsService],
})
export class AgentDownloadsModule {}
