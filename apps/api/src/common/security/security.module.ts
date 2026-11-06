import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../database/platform-database.module.js';
import { AuthSecrets } from './auth-secrets.js';
import { PlatformAudit } from './platform-audit.js';

/** What accounts and their e-mails share: derived secrets and the platform audit log. */
@Module({
  imports: [PlatformDatabaseModule],
  providers: [AuthSecrets, PlatformAudit],
  exports: [AuthSecrets, PlatformAudit],
})
export class SecurityModule {}
