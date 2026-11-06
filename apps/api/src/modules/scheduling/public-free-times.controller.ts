import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicCache } from '../../common/http/public-cache.decorator.js';
import { Public } from '../../common/security/public.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import {
  PublicAvailabilityDto,
  PublicAvailabilityQueryDto,
  PublicFreeTimesDto,
  PublicFreeTimesQueryDto,
} from './public-free-times.dto.js';
import { PublicFreeTimesService } from './public-free-times.service.js';

/** Per route and address: a page polls every 45 seconds and asks again for each day a visitor picks. */
export const PUBLIC_FREE_TIMES_REQUESTS_PER_MINUTE = 60;

/** How long a browser or a cache may keep an answer; nothing in it is personal (08 P05). */
const CACHE_SECONDS = 30;

/** The free times of a published practice, without sign-in (BR-22). */
@ApiTags('public-practice')
@Controller('public/practices/:slug')
export class PublicFreeTimesController {
  constructor(private readonly freeTimes: PublicFreeTimesService) {}

  @Public() // BR-22: whether a day has a free time, and never a count or a booked time
  @PracticeScoped('slug')
  @Throttle({ default: { ttl: 60_000, limit: PUBLIC_FREE_TIMES_REQUESTS_PER_MINUTE } })
  @PublicCache(CACHE_SECONDS)
  @ApiOperation({ summary: 'Which days of a range have free times' })
  @ApiParam({ name: 'slug', type: String, example: 'al-noor' })
  @ApiOkResponse({ type: PublicAvailabilityDto })
  @Get('availability')
  async getPublicAvailability(
    @Query() query: PublicAvailabilityQueryDto,
  ): Promise<PublicAvailabilityDto> {
    return this.freeTimes.availability(query);
  }

  @Public() // BR-22, BR-24: free start times, and a provider only with a public profile
  @PracticeScoped('slug')
  @Throttle({ default: { ttl: 60_000, limit: PUBLIC_FREE_TIMES_REQUESTS_PER_MINUTE } })
  @PublicCache(CACHE_SECONDS)
  @ApiOperation({ summary: 'The free start times of one day' })
  @ApiParam({ name: 'slug', type: String, example: 'al-noor' })
  @ApiOkResponse({ type: PublicFreeTimesDto })
  @Get('slots')
  async getPublicFreeTimes(@Query() query: PublicFreeTimesQueryDto): Promise<PublicFreeTimesDto> {
    return this.freeTimes.freeTimesOfDay(query);
  }
}
