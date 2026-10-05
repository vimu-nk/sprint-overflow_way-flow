import { Global, Module } from '@nestjs/common';
import { ViewsService } from './views.service.js';

@Global()
@Module({ providers: [ViewsService], exports: [ViewsService] })
export class ViewsModule {}
