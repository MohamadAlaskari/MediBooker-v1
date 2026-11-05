import { Module } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import { PlatformPrismaService } from './platform-prisma.service.js';
import { SecretStore, secretStoreFor } from './secret-store.js';

/** The platform database client and the secret store that SECRET_STORE selects (02 §5). */
@Module({
  providers: [
    PlatformPrismaService,
    { provide: SecretStore, inject: [ENV], useFactory: secretStoreFor },
  ],
  exports: [PlatformPrismaService, SecretStore],
})
export class PlatformDatabaseModule {}
