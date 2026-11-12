import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { ENV } from '../../config/env.module.js';
import { AccountNotifications } from './account-notifications.js';
import { AccountOutbox } from './account-outbox.js';
import { EmailSender, emailSenderFor } from './email-sender.js';
import { InstallationPractice } from './installation-practice.js';

/** Account and security e-mails (A02). Practice messages follow with N01. */
@Module({
  // Tenancy: the practice's own settings, for a time in a security e-mail (A04).
  imports: [PlatformDatabaseModule, SecurityModule, TenancyModule],
  providers: [
    AccountNotifications,
    AccountOutbox,
    InstallationPractice,
    { provide: EmailSender, inject: [ENV], useFactory: emailSenderFor },
  ],
  exports: [AccountNotifications, InstallationPractice],
})
export class NotificationsModule {}
