import type { ServerResponse } from 'node:http';
import { Controller, Get, Header, Headers, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/security/public.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import type { PublicPracticeDto } from './public-practice.dto.js';
import { PublicPracticeService } from './public-practice.service.js';

/** Per route and address: scraping is cheap, and every view costs a practice database query. */
export const PUBLIC_PRACTICE_REQUESTS_PER_MINUTE = 60;

/** The public practice page's data, without sign-in (BR-22). */
@Controller('public/practices')
export class PublicPracticeController {
  constructor(private readonly practices: PublicPracticeService) {}

  @Public() // BR-22: published practices only, and only the fields of PublicPracticeDto
  @PracticeScoped('slug')
  @Throttle({ default: { ttl: 60_000, limit: PUBLIC_PRACTICE_REQUESTS_PER_MINUTE } })
  // Not cached: a withdrawn consent must disappear at once (BR-24).
  @Header('Cache-Control', 'no-store')
  @Get(':slug')
  async practice(
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PublicPracticeDto> {
    const practice = await this.practices.read(acceptLanguage);
    response.setHeader('Content-Language', practice.locale);
    return practice;
  }
}
