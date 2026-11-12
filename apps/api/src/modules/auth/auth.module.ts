import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { Authenticator } from '../../common/security/actor.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccessTokens } from './access-tokens.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MeController } from './me.controller.js';
import { SecondFactor } from './second-factor.js';
import { SessionAuthenticator } from './session-authenticator.js';
import { KnownDevices } from './known-devices.js';
import { SignInAttempts } from './sign-in-attempts.js';
import { UnconfirmedAccountsJob } from './unconfirmed-accounts.job.js';

/** Accounts, sessions and their e-mails (ADR 0004). What a person may do in a practice follows. */
@Module({
  imports: [NotificationsModule, PlatformDatabaseModule, SecurityModule],
  controllers: [AuthController, MeController],
  providers: [
    SignInAttempts,
    UnconfirmedAccountsJob,
    AccessTokens,
    AccountService,
    AuthService,
    KnownDevices,
    SecondFactor,
    { provide: Authenticator, useClass: SessionAuthenticator },
  ],
  exports: [Authenticator],
})
export class AuthModule {}
