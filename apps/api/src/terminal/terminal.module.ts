import { Module } from '@nestjs/common';
import { AgentAuthGuard } from '../agents/agent-auth.guard';
import { CredentialsService } from './credentials.service';
import { TerminalController } from './terminal.controller';
import { AgentTerminalGateway, TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';

@Module({
  controllers: [TerminalController],
  providers: [TerminalService, CredentialsService, TerminalGateway, AgentTerminalGateway, AgentAuthGuard],
  exports: [TerminalService],
})
export class TerminalModule {}
