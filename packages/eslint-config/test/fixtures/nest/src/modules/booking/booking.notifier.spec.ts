// Synthetic violations in a test: the constant-message and context rules cover tests too.
import { Logger } from '@nestjs/common';

export function logProbe(email: string): void {
  new Logger().log(`probe for ${email}`);
}
