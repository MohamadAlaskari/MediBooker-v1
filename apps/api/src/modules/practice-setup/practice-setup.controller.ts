import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { PracticeHours } from './practice-hours.js';
import {
  OpeningHoursDto,
  OpeningHoursInputDto,
  ServiceDto,
  ServiceInputDto,
  ServiceListDto,
  ServicePatchDto,
  ServiceProvidersInputDto,
  SpecialDayDto,
  SpecialDayInputDto,
  SpecialDayListDto,
} from './practice-setup.dto.js';
import { ServiceCatalog } from './service-catalog.js';

/** Who manages services: practice management (D17). */
const SERVICE_EDITORS = 'management';
/** Who changes when the practice is open: the practice team and practice management (D17). */
const HOURS_EDITORS = 'planning';
/**
 * Per route, address and minute: what the practice team or management changes by hand, with room for a
 * team that shares one address (security review of M02).
 */
const SETUP_CHANGE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * What the team sets up for the practice (M02): the services (W12, W13), the opening hours and the
 * special days (W20). Public data, which the public page shows; every change is audited.
 */
@ApiTags('practice-setup')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId')
export class PracticeSetupController {
  constructor(
    private readonly services: ServiceCatalog,
    private readonly hours: PracticeHours,
  ) {}

  @PracticeScoped('id', { staff: 'team' })
  @ApiOperation({
    summary: 'Every service, also the archived ones, with the doctors who offer it',
  })
  @ApiOkResponse({ type: ServiceListDto })
  @Get('services')
  async listServices(): Promise<ServiceListDto> {
    return this.services.list();
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: SERVICE_EDITORS })
  @ApiOperation({ summary: 'Add a service; practice management only' })
  @ApiCreatedResponse({ type: ServiceDto })
  @Post('services')
  async createService(
    @CurrentUser() actor: Actor,
    @Body() input: ServiceInputDto,
    @Ip() ip: string,
  ): Promise<ServiceDto> {
    return this.services.create(actor, input, ip);
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: SERVICE_EDITORS })
  @ApiOperation({ summary: 'Change or archive a service; practice management only' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceDto })
  @Patch('services/:serviceId')
  async updateService(
    @CurrentUser() actor: Actor,
    @Param('serviceId') serviceId: string,
    @Body() input: ServicePatchDto,
    @Ip() ip: string,
  ): Promise<ServiceDto> {
    return this.services.update(actor, serviceId, input, ip);
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: SERVICE_EDITORS })
  @ApiOperation({
    summary:
      'The doctors who offer a service, through their working hours; practice management only',
  })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceDto })
  @Put('services/:serviceId/providers')
  async setServiceProviders(
    @CurrentUser() actor: Actor,
    @Param('serviceId') serviceId: string,
    @Body() input: ServiceProvidersInputDto,
    @Ip() ip: string,
  ): Promise<ServiceDto> {
    return this.services.setProviders(actor, serviceId, input, ip);
  }

  @PracticeScoped('id', { staff: 'team' })
  @ApiOperation({ summary: "The practice's opening hours, by weekday" })
  @ApiOkResponse({ type: OpeningHoursDto })
  @Get('opening-hours')
  async getOpeningHours(): Promise<OpeningHoursDto> {
    return this.hours.week();
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: HOURS_EDITORS })
  @ApiOperation({
    summary: 'Replace the whole week; an overlap is the field error OVERLAPS_EXISTING',
  })
  @ApiOkResponse({ type: OpeningHoursDto })
  @Put('opening-hours')
  async replaceOpeningHours(
    @CurrentUser() actor: Actor,
    @Body() input: OpeningHoursInputDto,
    @Ip() ip: string,
  ): Promise<OpeningHoursDto> {
    return this.hours.replaceWeek(actor, input, ip);
  }

  @PracticeScoped('id', { staff: 'team' })
  @ApiOperation({ summary: 'The special days from today on' })
  @ApiOkResponse({ type: SpecialDayListDto })
  @Get('special-days')
  async listSpecialDays(): Promise<SpecialDayListDto> {
    return this.hours.specialDays();
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: HOURS_EDITORS })
  @ApiOperation({ summary: 'Add a special day; a date that has one already is ALREADY_EXISTS' })
  @ApiCreatedResponse({ type: SpecialDayDto })
  @Post('special-days')
  async createSpecialDay(
    @CurrentUser() actor: Actor,
    @Body() input: SpecialDayInputDto,
    @Ip() ip: string,
  ): Promise<SpecialDayDto> {
    return this.hours.addSpecialDay(actor, input, ip);
  }

  @Throttle(SETUP_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: HOURS_EDITORS })
  @ApiOperation({ summary: 'Remove a special day' })
  @ApiParam({ name: 'specialDayId', format: 'uuid' })
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('special-days/:specialDayId')
  async deleteSpecialDay(
    @CurrentUser() actor: Actor,
    @Param('specialDayId') specialDayId: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.hours.removeSpecialDay(actor, specialDayId, ip);
  }
}
