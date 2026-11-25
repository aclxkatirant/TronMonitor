import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { WsAuthService } from './ws-auth.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeService, RealtimeGateway, WsAuthService],
  exports: [RealtimeService, WsAuthService],
})
export class RealtimeModule {}
