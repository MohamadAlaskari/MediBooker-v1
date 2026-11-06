import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { ENV } from '../../config/env.module.js';
import { AccountNotifications } from './account-notifications.js';
import { AccountOutbox } from './account-outbox.js';
import { EmailSender, emailSenderFor } from './email-sender.js';

/** Account and security e-mails (A02). Practice messages follow with N01. */
@Module({
  imports: [PlatformDatabaseModule, SecurityModule],
  providers: [
    AccountNotifications,
    AccountOutbox,
    { provide: EmailSender, inject: [ENV], useFactory: emailSenderFor },
  ],
  exports: [AccountNotifications],
})
export class NotificationsModule {}
