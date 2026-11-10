import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { ALL_STAFF_ROLES, PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { MembershipDto } from './staff.dto.js';

/** The caller's own membership in a practice: who that is comes from the verified token only. */
@ApiTags('staff')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId/me/membership')
export class MembershipController {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary:
      'The own role in this practice, for the dashboard; MFA_REQUIRED without a second factor',
  })
  @ApiOkResponse({ type: MembershipDto })
  @Get()
  getMyMembership(): MembershipDto {
    const { staff } = requirePracticeContext(this.cls);
    if (staff === undefined) throw new Error('membership route without a staff membership');
    return { role: staff.role };
  }
}
