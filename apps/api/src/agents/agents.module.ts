import { Module } from '@nestjs/common';
import { RegistrationModule } from '../registration/registration.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentStatusScheduler } from './agent-status.scheduler';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [RegistrationModule, MetricsModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentAuthGuard, AgentStatusScheduler],
  exports: [AgentsService],
})
export class AgentsModule {}
