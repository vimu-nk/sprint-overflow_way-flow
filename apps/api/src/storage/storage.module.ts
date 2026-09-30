import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';

export const S3 = Symbol('S3');
// Bucket and the API's scoped key are provisioned by infra/rustfs/init.sh (storage-init).
export const BUCKET = process.env.S3_BUCKET ?? 'pod';

@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: () =>
        new S3Client({
          endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
          region: 'us-east-1',
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY ?? 'wayflow-app',
            secretAccessKey: process.env.S3_SECRET_KEY ?? 'wayflow-app-secret',
          },
        }),
    },
  ],
  exports: [S3],
})
export class StorageModule {}
