import { Body, Controller, Get, Ip, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { PracticeAccessIndex } from '../../common/tenancy/practice-access-index.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import {
  JoinPracticeDto,
  MyPracticeDto,
  MyPracticeListDto,
  PatientDto,
  PatientListDto,
  UpdatePatientDto,
} from './patients.dto.js';
import { PatientsService } from './patients.service.js';

/**
 * Per address and minute, and in front of the sign-in. A limit per day here would let a stranger on a
 * practice's wireless network lock its patients out for a day: that limit is the account's, and the
 * service holds it.
 */
const JOIN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** A person's own profile in a practice: who that is comes from the verified token only. */
@ApiTags('patients')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId/me/patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Throttle(JOIN_LIMIT)
  @PracticeScoped('id', { join: true })
  @ApiOperation({ summary: 'Join a practice: copies the own details and asks for what is missing' })
  @ApiCreatedResponse({ type: PatientDto })
  @Post()
  async joinPractice(
    @CurrentUser() actor: Actor,
    @Body() input: JoinPracticeDto,
    @Ip() ip: string,
  ): Promise<PatientDto> {
    return this.patients.join(actor, input, ip);
  }

  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'The profiles of the caller in this practice; 404 before a join' })
  @ApiOkResponse({ type: PatientListDto })
  @Get()
  async listMyPatients(): Promise<PatientListDto> {
    return this.patients.mine();
  }

  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'The own profile in this practice' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: PatientDto })
  @Get(':patientId')
  async getMyPatient(@Param('patientId') patientId: string): Promise<PatientDto> {
    return this.patients.own(patientId);
  }

  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'Change the own profile in this practice; what is left out stays' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: PatientDto })
  @Patch(':patientId')
  async updateMyPatient(
    @CurrentUser() actor: Actor,
    @Param('patientId') patientId: string,
    @Body() input: UpdatePatientDto,
    @Ip() ip: string,
  ): Promise<PatientDto> {
    return this.patients.update(actor, patientId, input, ip);
  }
}

/** The practices of the account, from the platform database only. */
@ApiTags('me')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@Controller('me/practices')
export class MyPracticesController {
  constructor(private readonly index: PracticeAccessIndex) {}

  @ApiOperation({ summary: 'The practices of this account, with the capacity in each' })
  @ApiOkResponse({ type: MyPracticeListDto })
  @Get()
  async listMyPractices(@CurrentUser() actor: Actor): Promise<MyPracticeListDto> {
    const practices = await this.index.practicesOf(actor.userId);
    return {
      items: practices.map(({ id, slug, name, capacity }): MyPracticeDto => ({
        id,
        slug,
        name: name as Readonly<Record<string, string>>,
        capacity,
      })),
    };
  }
}
