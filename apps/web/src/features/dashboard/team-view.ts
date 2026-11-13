import type {
  ChangeTeamRoleDto,
  TeamDoctorDto,
  TeamDto,
  TeamMemberDto,
} from '@medibooker/api-client';

/** The views of the team page (W15): everyone, by place, and the deactivated on their own. */
export const TEAM_FILTERS = ['ALL', 'DOCTORS', 'STAFF', 'MANAGEMENT', 'INACTIVE'] as const;
export type TeamFilter = (typeof TEAM_FILTERS)[number];

/** A tab's key as a view; anything else is everyone. */
export function filterOf(key: unknown): TeamFilter {
  return TEAM_FILTERS.find((filter) => filter === key) ?? 'ALL';
}

/** Whom a view shows: the views by place show the active members, who can work in that place. */
export function inView(filter: TeamFilter, member: TeamMemberDto): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'DOCTORS':
      return member.active && member.role === 'DOCTOR';
    case 'STAFF':
      return member.active && member.role === 'STAFF';
    case 'MANAGEMENT':
      return member.active && member.managesPractice;
    case 'INACTIVE':
      return !member.active;
  }
}

/** How many each view shows, for its tab. */
export function countsOf(members: readonly TeamMemberDto[]): Readonly<Record<TeamFilter, number>> {
  const count = (filter: TeamFilter): number =>
    members.filter((member) => inView(filter, member)).length;
  return {
    ALL: count('ALL'),
    DOCTORS: count('DOCTORS'),
    STAFF: count('STAFF'),
    MANAGEMENT: count('MANAGEMENT'),
    INACTIVE: count('INACTIVE'),
  };
}

/** What names a member on the page: the name of the account, else its e-mail address. */
export function nameOf(member: Pick<TeamMemberDto, 'name' | 'email'>): string {
  return member.name ?? member.email;
}

/** The active members first, each part in the alphabet of the page's language. */
export function sortedTeam(members: readonly TeamMemberDto[], locale: string): TeamMemberDto[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return members.toSorted(
    (a, b) => Number(b.active) - Number(a.active) || collator.compare(nameOf(a), nameOf(b)),
  );
}

/** A doctor of the practice in the role form: one account each, so another's is not offered. */
export interface DoctorChoice {
  readonly id: string;
  readonly name: string;
  /** Another account is this doctor (M04): the API would answer DOCTOR_ALREADY_LINKED. */
  readonly taken: boolean;
}

export function doctorChoicesOf(
  team: Pick<TeamDto, 'doctors'>,
  member: Pick<TeamMemberDto, 'id'>,
): DoctorChoice[] {
  return team.doctors.map(({ id, name, membershipId }: TeamDoctorDto) => ({
    id,
    name,
    taken: membershipId !== null && membershipId !== member.id,
  }));
}

/** What the role form chose: a base role, practice management, and for a doctor its link. */
export interface RoleChoice {
  readonly role: 'STAFF' | 'DOCTOR';
  readonly managesPractice: boolean;
  /** Null: not linked to a doctor (yet). */
  readonly doctorId: string | null;
}

/**
 * The change as the API takes it: a doctor always names its link, so that what the form shows is
 * what is saved; the practice team names none, and the API takes the link away.
 */
export function roleChangeOf(choice: RoleChoice): ChangeTeamRoleDto {
  return choice.role === 'DOCTOR'
    ? { role: 'DOCTOR', managesPractice: choice.managesPractice, providerId: choice.doctorId }
    : { role: 'STAFF', managesPractice: choice.managesPractice };
}
