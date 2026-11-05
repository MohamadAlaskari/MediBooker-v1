import { Injectable } from '@nestjs/common';

/**
 * The counters of the practice connections (02 §5), shared by the connection manager and the
 * opener; `PracticeConnectionManager.stats()` reports them with the open clients per purpose.
 * OPS01 exports them as metrics.
 */
@Injectable()
export class PracticeConnectionMetrics {
  /** Clients the manager started to open. */
  creations = 0;
  /** Clients closed to make room or because they were idle or of an older route version. */
  evictions = 0;
  /** Acquisitions that had to wait for capacity or the creation rate. */
  waits = 0;
  /** Passwords the database refused (28P01). */
  authenticationFailures = 0;
  /** Databases whose practice_identity named another practice. */
  identityMismatches = 0;
  /** Databases whose CONNECT was open to PUBLIC. */
  openAcls = 0;
}
