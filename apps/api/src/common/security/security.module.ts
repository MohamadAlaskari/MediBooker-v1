import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../database/platform-database.module.js';
import { AuthSecrets } from './auth-secrets.js';
import { FieldCipher } from './field-cipher.js';
import { PlatformAudit } from './platform-audit.js';

/** What accounts and their e-mails share: secrets, encrypted fields and the platform audit log. */
@Module({
  imports: [PlatformDatabaseModule],
  providers: [AuthSecrets, FieldCipher, PlatformAudit],
  exports: [AuthSecrets, FieldCipher, PlatformAudit],
})
export class SecurityModule {}
