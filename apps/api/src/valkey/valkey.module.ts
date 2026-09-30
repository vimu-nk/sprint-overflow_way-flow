import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Valkey } from 'iovalkey';

export const VALKEY = Symbol('VALKEY');

@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      useFactory: () => new Valkey(process.env.VALKEY_URL ?? 'redis://localhost:6379'),
    },
  ],
  exports: [VALKEY],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  async onApplicationShutdown() {
    await this.valkey.quit();
  }
}
