import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { env } from '../env.js';

export const S3 = Symbol('S3');
// Bucket and the API's scoped key are provisioned by infra/rustfs/init.sh (storage-init).
export const BUCKET = env.S3_BUCKET;

@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: () =>
        new S3Client({
          endpoint: env.S3_ENDPOINT || undefined,
          region: env.S3_REGION,
          forcePathStyle: !!env.S3_ENDPOINT, // RustFS/MinIO need path-style; AWS does not
          // No access key configured (AWS) → the SDK uses the instance/task IAM role.
          credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : undefined,
        }),
    },
  ],
  exports: [S3],
})
export class StorageModule {}
