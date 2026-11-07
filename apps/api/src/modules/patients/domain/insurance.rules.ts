import type { InsuranceTypeName } from '../../account-profile/domain/profile.rules.js';

/** What a practice asks of each insurance type (BR-10), from its settings. */
export interface InsuranceRules {
  readonly insuranceTypes: readonly string[];
  readonly insuranceProviderTypes: readonly string[];
  readonly insuranceNumberTypes: readonly string[];
}

export type FieldProblemCode = 'REQUIRED' | 'INVALID_VALUE';

export interface FieldProblem {
  readonly field: string;
  readonly code: FieldProblemCode;
}

/** What a person gave, or what is known of them. */
export interface InsuranceInput {
  readonly type: InsuranceTypeName | undefined;
  readonly provider: string | null | undefined;
  /** As typed: normalised here. */
  readonly number: string | undefined;
  /** The row already has a number for this type, so none has to be given. */
  readonly numberKnown: boolean;
}

export interface CheckedInsurance {
  readonly problems: readonly FieldProblem[];
  readonly provider: string | null;
  /** Normalised; undefined when none was given or this type keeps none. */
  readonly number: string | undefined;
}

/** The zeros of the digits people type on an Arabic keyboard, mapped to ASCII below. */
const ARABIC_ZEROS: readonly number[] = [0x0660, 0x06f0];
const DIGITS_IN_A_RUN = 10;

function asciiDigit(character: string): string {
  const code = character.charCodeAt(0);
  const zero = ARABIC_ZEROS.find((start) => code >= start && code < start + DIGITS_IN_A_RUN);
  return zero === undefined ? character : String(code - zero);
}

/**
 * One spelling for one number, so that it means the same in the validator and the blind index: Arabic
 * digits become ASCII, separators go, letters become upper case. Undefined for anything else: a
 * letter of another script can look like a Latin one and would index differently.
 */
export function normalizedInsuranceNumber(raw: string): string | undefined {
  const compact = raw
    .normalize('NFKC')
    .replaceAll(/\p{Nd}/gu, (digit) => asciiDigit(digit))
    .replaceAll(/[\s./-]/gu, '');
  return /^[A-Za-z0-9]+$/.test(compact) ? compact.toUpperCase() : undefined;
}

/** The number formats per market and type (BR-10): market rules are configuration, not branches. */
const NUMBER_FORMATS: Readonly<Record<string, Partial<Record<InsuranceTypeName, RegExp>>>> = {
  DE: { PUBLIC: /^[A-Z][0-9]{9}$/ },
};
const ANY_MARKET_FORMAT = /^[A-Z0-9]{6,40}$/;

export function isValidInsuranceNumber(
  market: string,
  type: InsuranceTypeName,
  number: string,
): boolean {
  return (NUMBER_FORMATS[market]?.[type] ?? ANY_MARKET_FORMAT).test(number);
}

/** A self-payer never keeps a provider or a number, whatever a practice's settings say (BR-10). */
function keepsDetails(type: InsuranceTypeName): boolean {
  return type !== 'SELF_PAY';
}

/** The insurance of a person against the rules of a practice in a market (BR-10). */
export function checkedInsurance(
  rules: InsuranceRules,
  market: string,
  { type, provider, number, numberKnown }: InsuranceInput,
): CheckedInsurance {
  if (type === undefined) {
    return {
      problems: [{ field: 'insuranceType', code: 'REQUIRED' }],
      provider: null,
      number: undefined,
    };
  }
  if (!rules.insuranceTypes.includes(type)) {
    return {
      problems: [{ field: 'insuranceType', code: 'INVALID_VALUE' }],
      provider: null,
      number: undefined,
    };
  }
  if (!keepsDetails(type)) return { problems: [], provider: null, number: undefined };

  const problems: FieldProblem[] = [];
  const hasProvider = provider !== undefined && provider !== null && provider !== '';
  if (rules.insuranceProviderTypes.includes(type) && !hasProvider) {
    problems.push({ field: 'insuranceProvider', code: 'REQUIRED' });
  }
  const normalized = number === undefined ? undefined : normalizedInsuranceNumber(number);
  if (number !== undefined) {
    if (normalized === undefined || !isValidInsuranceNumber(market, type, normalized)) {
      problems.push({ field: 'insuranceNumber', code: 'INVALID_VALUE' });
    }
  } else if (rules.insuranceNumberTypes.includes(type) && !numberKnown) {
    problems.push({ field: 'insuranceNumber', code: 'REQUIRED' });
  }
  return { problems, provider: hasProvider ? provider : null, number: normalized };
}
