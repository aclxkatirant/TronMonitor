import { Module } from '@nestjs/common';
import { GroupsTagsService } from './groups-tags.service';
import { ServerGroupsController, ServersController, TagsController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  controllers: [ServersController, ServerGroupsController, TagsController],
  providers: [ServersService, GroupsTagsService],
  exports: [ServersService],
})
export class ServersModule {}
