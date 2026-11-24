import { Global, Module } from '@nestjs/common';
import { AgentServicesController, ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { AgentAuthGuard } from '../agents/agent-auth.guard';

@Global()
@Module({
  controllers: [AgentServicesController, ServicesController],
  providers: [ServicesService, AgentAuthGuard],
  exports: [ServicesService],
})
export class ServicesModule {}
