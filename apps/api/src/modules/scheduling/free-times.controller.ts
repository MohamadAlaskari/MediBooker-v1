import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import {
  AvailabilityDto,
  AvailabilityQueryDto,
  FreeTimesDto,
  FreeTimesQueryDto,
} from './free-times.dto.js';
import { FreeTimesService } from './free-times.service.js';

/** Per route and address: a page polls every 45 seconds and asks again for each day a person picks. */
export const FREE_TIMES_REQUESTS_PER_MINUTE = 60;

/**
 * The free times of a published practice, for a signed-in account with a confirmed address (BR-22):
 * the user's decision of 2026-11-12, so that a practice's times are not public. No patient profile is
 * needed yet: that comes with the first booking.
 */
@ApiTags('free-times')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId')
export class FreeTimesController {
  constructor(private readonly freeTimes: FreeTimesService) {}

  // BR-22: whether a day has a free time, and never a count or a booked time
  @PracticeScoped('id', { account: true })
  @Throttle({ default: { ttl: 60_000, limit: FREE_TIMES_REQUESTS_PER_MINUTE } })
  @ApiOperation({ summary: 'Which days of a range have free times' })
  @ApiOkResponse({ type: AvailabilityDto })
  @Get('availability')
  async getAvailability(@Query() query: AvailabilityQueryDto): Promise<AvailabilityDto> {
    return this.freeTimes.availability(query);
  }

  // BR-22, BR-24: free start times, and a doctor by name only with a public profile
  @PracticeScoped('id', { account: true })
  @Throttle({ default: { ttl: 60_000, limit: FREE_TIMES_REQUESTS_PER_MINUTE } })
  @ApiOperation({ summary: 'The free start times of one day' })
  @ApiOkResponse({ type: FreeTimesDto })
  @Get('free-times')
  async getFreeTimes(@Query() query: FreeTimesQueryDto): Promise<FreeTimesDto> {
    return this.freeTimes.freeTimesOfDay(query);
  }
}
