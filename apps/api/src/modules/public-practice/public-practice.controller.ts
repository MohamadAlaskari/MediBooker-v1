import type { ServerResponse } from 'node:http';
import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CursorQueryDto } from '../../common/http/cursor-page.js';
import { Public } from '../../common/security/public.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { PublicPracticeDto, PublicPracticeListDto } from './public-practice.dto.js';
import { PublicPracticeService } from './public-practice.service.js';

/** Per route and address: scraping is cheap, and every view costs a practice database query. */
export const PUBLIC_PRACTICE_REQUESTS_PER_MINUTE = 60;

/**
 * The public practice page's data, without sign-in (BR-22). Not cached (the NoStoreInterceptor's
 * default stays): a withdrawn consent must disappear at once (BR-24).
 */
@ApiTags('public-practice')
@Controller('public/practices')
export class PublicPracticeController {
  constructor(private readonly practices: PublicPracticeService) {}

  @Public() // BR-22: the slugs of published practices, and nothing else about them
  @Throttle({ default: { ttl: 60_000, limit: PUBLIC_PRACTICE_REQUESTS_PER_MINUTE } })
  @ApiOperation({ summary: 'The published practices, for the sitemap' })
  @ApiOkResponse({ type: PublicPracticeListDto })
  @Get()
  async listPublicPractices(@Query() query: CursorQueryDto): Promise<PublicPracticeListDto> {
    return this.practices.list(query);
  }

  @Public() // BR-22: published practices only, and only the fields of PublicPracticeDto
  @PracticeScoped('slug')
  @Throttle({ default: { ttl: 60_000, limit: PUBLIC_PRACTICE_REQUESTS_PER_MINUTE } })
  @ApiOperation({ summary: 'The public page of a published practice' })
  @ApiParam({ name: 'slug', type: String, example: 'al-noor' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    description: "Chooses among the practice's locales; default: its default locale",
  })
  @ApiOkResponse({ type: PublicPracticeDto })
  @Get(':slug')
  async getPublicPractice(
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PublicPracticeDto> {
    const practice = await this.practices.read(acceptLanguage);
    response.setHeader('Content-Language', practice.locale);
    return practice;
  }
}
