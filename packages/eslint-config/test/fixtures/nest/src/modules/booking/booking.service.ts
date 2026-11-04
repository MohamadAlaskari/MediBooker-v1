// With emitDecoratorMetadata, the constructor parameter type of a decorated class is emitted as
// a runtime value for dependency injection, so SystemClock must stay a value import.
import { SystemClock } from '../../common/clock/system-clock.js';

/** A synthetic stand-in for Nest's @Injectable(). */
function Injectable(): ClassDecorator {
  return () => undefined;
}

@Injectable()
export class BookingService {
  constructor(private readonly clock: SystemClock) {}

  bookedAt(): Date {
    return this.clock.now();
  }
}
