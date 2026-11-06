import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsString,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DomainException } from '../../src/common/errors/domain.exception.js';
import { Public } from '../../src/common/security/public.decorator.js';
import { PracticeUnavailableError } from '../../src/common/tenancy/practice-errors.js';

class ProbeItemDto {
  @IsString()
  @MaxLength(5)
  name!: string;
}

/** A DTO with one case of each kind the validation mapping knows. */
class ProbeBodyDto {
  @IsEmail({}, { context: { params: { hint: 'public' } } })
  email!: string;

  @IsInt()
  @Max(10)
  count!: number;

  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProbeItemDto)
  items!: ProbeItemDto[];
}

function prismaError(code: string): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('secret-value', { code, clientVersion: 'test' });
}

/** Test-only routes under /api/v1/errors-probe; they never exist in src (02 §12). */
@Controller('errors-probe')
class ErrorsProbeController {
  @Public() // test-only: validates a DTO, so a test can read the field errors
  @Post('validate')
  validate(@Body() body: ProbeBodyDto): { accepted: true; items: number } {
    return { accepted: true, items: body.items.length };
  }

  @Public() // test-only: an expected failure with every option of a DomainException
  @Get('domain')
  domain(): never {
    throw new DomainException('CONFLICT', {
      detail: 'The slot was booked by another request.',
      params: { maxFutureAppointments: 2 },
    });
  }

  @Public() // test-only: a 5xx DomainException, which is logged
  @Get('domain-internal')
  domainInternal(): never {
    throw new DomainException('INTERNAL_ERROR', { cause: new Error('secret-value') });
  }

  @Public() // test-only: a practice that cannot be served, outside a practice-scoped route
  @Get('practice-unavailable')
  practiceUnavailable(): never {
    throw new PracticeUnavailableError(randomUUID(), 'PRACTICE_CONNECTION_FAILED');
  }

  @Public() // test-only: an HttpException whose text must not reach the client
  @Get('http-exception')
  httpException(): never {
    throw new ServiceUnavailableException('secret-value');
  }

  @Public() // test-only: a unique violation that no service translated
  @Get('prisma-conflict')
  prismaConflict(): never {
    throw prismaError('P2002');
  }

  @Public() // test-only: a missing row that no service translated
  @Get('prisma-not-found')
  prismaNotFound(): never {
    throw prismaError('P2025');
  }

  @Public() // test-only: a Prisma error without a mapping
  @Get('prisma-other')
  prismaOther(): never {
    throw prismaError('P9999');
  }
}

@Module({ controllers: [ErrorsProbeController] })
export class ValidationProbeModule {}
