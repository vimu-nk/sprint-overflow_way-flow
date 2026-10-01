import { Global, Module } from '@nestjs/common';
import { ReferenceService } from './reference.service.js';

@Global()
@Module({ providers: [ReferenceService], exports: [ReferenceService] })
export class ReferenceModule {}
