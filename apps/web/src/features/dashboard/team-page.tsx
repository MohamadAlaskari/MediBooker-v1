'use client';

import {
  deactivateTeamMember,
  reactivateTeamMember,
  resetTeamSecondFactor,
  useChangeTeamRole,
  useListTeam,
  type TeamDto,
  type TeamMemberDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, KeyRound, Pencil, UserCheck, UserX, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import { FormError } from '../auth/form-parts';
import { useDesk } from './desk-context';
import { isPracticeQueryOf } from './setup-view';
import {
  countsOf,
  doctorChoicesOf,
  filterOf,
  inView,
  nameOf,
  roleChangeOf,
  sortedTeam,
  TEAM_FILTERS,
  type TeamFilter,
} from './team-view';

const LABEL = 'text-label-default text-text-primary';
const HEADER = 'px-5 py-3 text-start text-body-small text-text-secondary';
/** The key of "not linked" among the doctors: no doctor has it, as theirs are UUIDs. */
const NO_DOCTOR = 'none';

/** After a change of the team every answer of the practice may differ, the own place too. */
function useAfterTeamChange(): () => Promise<void> {
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) => isPracticeQueryOf(practiceId, queryKey),
    });
}

/**
 * The role form (W15, D17): a base role, for a doctor the doctor it is, and practice management.
 * The API keeps the last person with practice management (LAST_PRACTICE_MANAGER) and one account per
 * doctor (DOCTOR_ALREADY_LINKED); a doctor another account is already is not offered here.
 */
function RoleForm({
  member,
  team,
  onCancel,
  onSaved,
}: {
  readonly member: TeamMemberDto;
  readonly team: TeamDto;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.roleForm');
  const { practiceId } = useDesk();
  const afterChange = useAfterTeamChange();
  const change = useChangeTeamRole({ mutation: { onSettled: afterChange } });
  const [role, setRole] = useState(member.role);
  const [doctorId, setDoctorId] = useState(member.doctor?.id ?? NO_DOCTOR);
  const [managesPractice, setManagesPractice] = useState(member.managesPractice);
  const managementHintId = useId();
  const choices = doctorChoicesOf(team, member);
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        change.mutate(
          {
            practiceId,
            membershipId: member.id,
            data: roleChangeOf({
              role,
              managesPractice,
              doctorId: doctorId === NO_DOCTOR ? null : doctorId,
            }),
          },
          { onSuccess: onSaved },
        );
      }}
    >
      <FormError error={change.error} />
      <RadioGroup
        label={t('role')}
        value={role}
        onChange={(value) => {
          setRole(value === 'DOCTOR' ? 'DOCTOR' : 'STAFF');
        }}
      >
        <Radio value="STAFF">{t('staff')}</Radio>
        <Radio value="DOCTOR">{t('doctor')}</Radio>
      </RadioGroup>
      {role === 'DOCTOR' ? (
        <Select
          value={doctorId}
          onChange={(key) => {
            if (key !== null) setDoctorId(String(key));
          }}
          disabledKeys={choices.filter(({ taken }) => taken).map(({ id }) => id)}
        >
          <Label className={LABEL}>{t('doctorLink')}</Label>
          <SelectTrigger className="mt-2" />
          <SelectContent>
            <SelectItem id={NO_DOCTOR}>{t('notLinked')}</SelectItem>
            {choices.map(({ id, name, taken }) => (
              <SelectItem key={id} id={id} textValue={name}>
                {taken ? t('linkedElsewhere', { name: isolate(name) }) : <bdi>{name}</bdi>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <div className="flex flex-col gap-1">
        <Checkbox
          isSelected={managesPractice}
          onChange={setManagesPractice}
          aria-describedby={managementHintId}
        >
          {t('management')}
        </Checkbox>
        <p id={managementHintId} className="text-body-small text-text-secondary">
          {t('managementHint')}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-4">
        <Button variant="outline" isDisabled={change.isPending} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" isPending={change.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function RoleDialog({
  member,
  team,
  onDone,
}: {
  readonly member: TeamMemberDto;
  readonly team: TeamDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.team');
  const form = useTranslations('dashboard.roleForm');
  const [isOpen, setOpen] = useState(false);
  const name = isolate(nameOf(member));
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <Button variant="ghost">
        <Pencil aria-hidden data-icon="inline-start" />
        {t('changeRole')}
      </Button>
      <DialogContent
        title={form('title')}
        description={form('description', { name })}
        size="medium"
      >
        {(close) => (
          <RoleForm
            member={member}
            team={team}
            onCancel={close}
            onSaved={() => {
              close();
              onDone(t('roleNews', { name }));
            }}
          />
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

/** What a member action is called, asks and does, and what the page says after it. */
interface MemberActionKind {
  readonly label: 'deactivate' | 'reactivate' | 'resetSecondFactor';
  readonly title: 'deactivateTitle' | 'reactivateTitle' | 'resetTitle';
  readonly body: 'deactivateBody' | 'reactivateBody' | 'resetBody';
  readonly news: 'deactivatedNews' | 'reactivatedNews' | 'resetNews';
  readonly Icon: LucideIcon;
  readonly variant: 'default' | 'danger';
  readonly run: (practiceId: string, membershipId: string) => Promise<TeamMemberDto>;
}

const ACTIONS: Readonly<Record<'deactivate' | 'reactivate' | 'reset', MemberActionKind>> = {
  deactivate: {
    label: 'deactivate',
    title: 'deactivateTitle',
    body: 'deactivateBody',
    news: 'deactivatedNews',
    Icon: UserX,
    variant: 'danger',
    run: deactivateTeamMember,
  },
  reactivate: {
    label: 'reactivate',
    title: 'reactivateTitle',
    body: 'reactivateBody',
    news: 'reactivatedNews',
    Icon: UserCheck,
    variant: 'default',
    run: reactivateTeamMember,
  },
  reset: {
    label: 'resetSecondFactor',
    title: 'resetTitle',
    body: 'resetBody',
    news: 'resetNews',
    Icon: KeyRound,
    variant: 'danger',
    run: resetTeamSecondFactor,
  },
};

/**
 * Deactivating, reactivating and resetting the second factor (D17): each asks first, because it ends
 * a person's sign-ins or gives access back. The API refuses each on one's own account.
 */
function MemberAction({
  member,
  kind,
  onDone,
}: {
  readonly member: TeamMemberDto;
  readonly kind: keyof typeof ACTIONS;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.team');
  const confirm = useTranslations('dashboard.teamConfirm');
  const { practiceId } = useDesk();
  const afterChange = useAfterTeamChange();
  const action = ACTIONS[kind];
  const run = useMutation({
    mutationFn: () => action.run(practiceId, member.id),
    onSettled: afterChange,
  });
  const [isOpen, setOpen] = useState(false);
  const name = isolate(nameOf(member));
  const { Icon } = action;
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) run.reset();
      }}
    >
      <Button variant="ghost">
        <Icon aria-hidden data-icon="inline-start" />
        {t(action.label)}
      </Button>
      <DialogContent
        title={confirm(action.title, { name })}
        description={confirm(action.body)}
        isDismissable={!run.isPending}
      >
        {(close) => (
          <div className="flex flex-col gap-4">
            <FormError error={run.error} />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="outline" isDisabled={run.isPending} onPress={close}>
                {confirm('cancel')}
              </Button>
              <Button
                variant={action.variant}
                isPending={run.isPending}
                onPress={() => {
                  run.mutate(undefined, {
                    onSuccess: () => {
                      close();
                      onDone(t(action.news, { name }));
                    },
                  });
                }}
              >
                {t(action.label)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

function MemberRow({
  member,
  team,
  onDone,
}: {
  readonly member: TeamMemberDto;
  readonly team: TeamDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.team');
  const shell = useTranslations('dashboard.shell');
  return (
    <tr className="border-t border-border-subtle align-middle">
      <th scope="row" className="px-5 py-4 text-start font-normal">
        <span className="flex flex-wrap items-center gap-2">
          {member.name === null ? (
            <span dir="ltr" className="text-label-default text-text-primary">
              {member.email}
            </span>
          ) : (
            <span dir="auto" className="text-label-default text-text-primary">
              {member.name}
            </span>
          )}
          {member.you ? <Badge variant="brandSubtle">{t('you')}</Badge> : null}
        </span>
        {member.name === null ? (
          <span className="mt-1 block text-body-small text-text-secondary">{t('noName')}</span>
        ) : (
          <span dir="ltr" className="mt-1 block text-body-small text-text-secondary">
            {member.email}
          </span>
        )}
      </th>
      <td className="px-5 py-4">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-body-default text-text-primary">
            {shell('role', { role: member.role })}
          </span>
          {member.managesPractice ? <Badge variant="info">{shell('management')}</Badge> : null}
        </span>
      </td>
      <td className="px-5 py-4 text-body-default text-text-primary">
        {member.doctor !== null ? (
          <bdi>{member.doctor.name}</bdi>
        ) : (
          <span className="text-text-secondary">
            {member.role === 'DOCTOR' ? t('notLinked') : t('none')}
          </span>
        )}
      </td>
      <td className="px-5 py-4">
        <Badge variant={member.secondFactor ? 'success' : 'neutral'}>
          {member.secondFactor ? t('secondFactorOn') : t('secondFactorOff')}
        </Badge>
      </td>
      <td className="px-5 py-4">
        <Badge variant={member.active ? 'success' : 'neutral'}>
          {member.active ? t('active') : t('inactive')}
        </Badge>
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap justify-end gap-2">
          {member.active ? (
            <RoleDialog member={member} team={team} onDone={onDone} />
          ) : (
            <MemberAction member={member} kind="reactivate" onDone={onDone} />
          )}
          {member.active && member.secondFactor && !member.you ? (
            <MemberAction member={member} kind="reset" onDone={onDone} />
          ) : null}
          {member.active && !member.you ? (
            <MemberAction member={member} kind="deactivate" onDone={onDone} />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function TeamTable({
  members,
  team,
  onDone,
}: {
  readonly members: readonly TeamMemberDto[];
  readonly team: TeamDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.team');
  if (members.length === 0) {
    return <p className="p-4 text-body-default text-text-secondary">{t('empty')}</p>;
  }
  return (
    <table className="w-full min-w-[60rem] text-start">
      <caption className="sr-only">{t('table')}</caption>
      <thead className="bg-bg-subtle">
        <tr>
          <th scope="col" className={HEADER}>
            {t('person')}
          </th>
          <th scope="col" className={HEADER}>
            {t('role')}
          </th>
          <th scope="col" className={HEADER}>
            {t('doctor')}
          </th>
          <th scope="col" className={HEADER}>
            {t('secondFactor')}
          </th>
          <th scope="col" className={HEADER}>
            {t('status')}
          </th>
          <th scope="col" className={HEADER}>
            <span className="sr-only">{t('actions')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <MemberRow key={member.id} member={member} team={team} onDone={onDone} />
        ))}
      </tbody>
    </table>
  );
}

/**
 * W15: the practice's team, for practice management (D17): who is on it, in which role, which
 * doctor an account is, whether its second factor is set up; the views by place; and changing a
 * role, deactivating and reactivating, and resetting a lost authenticator app.
 */
export function TeamPage(): ReactNode {
  const t = useTranslations('dashboard.team');
  const locale = useLocale();
  const { practiceId, managesPractice } = useDesk();
  const team = useListTeam(practiceId, { query: { enabled: managesPractice, retry: false } });
  const [filter, setFilter] = useState<TeamFilter>('ALL');
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const data = team.data;
  const members = data === undefined ? [] : sortedTeam(data.members, locale);
  const counts = countsOf(members);
  const number = new Intl.NumberFormat(locale);
  return (
    <>
      <header className="mb-6">
        <p className="text-body-default text-text-secondary">
          {data === undefined
            ? String.fromCodePoint(0xa0)
            : t('summary', { count: counts.ALL, doctors: counts.DOCTORS })}
        </p>
        <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
      </header>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      {!managesPractice ? (
        <p className="text-body-default text-text-secondary">{t('onlyManagement')}</p>
      ) : data === undefined ? (
        team.isError ? (
          <FormError error={team.error} />
        ) : (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loading')}
          </p>
        )
      ) : (
        <Tabs
          selectedKey={filter}
          onSelectionChange={(key) => {
            setFilter(filterOf(key));
          }}
        >
          {/* Five views are wider than a phone: the row of tabs scrolls, not the page. */}
          <div className="overflow-x-auto p-1">
            <TabList aria-label={t('filters')}>
              {TEAM_FILTERS.map((id) => (
                <Tab key={id} id={id}>
                  <span className="whitespace-nowrap">{t('filter', { filter: id })}</span>
                  <Badge variant="neutral" className="ms-2">
                    {number.format(counts[id])}
                  </Badge>
                </Tab>
              ))}
            </TabList>
          </div>
          {TEAM_FILTERS.map((id) => (
            <TabPanel key={id} id={id}>
              <section
                aria-label={t('table')}
                className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-surface"
              >
                <TeamTable
                  members={members.filter((member) => inView(id, member))}
                  team={data}
                  onDone={setNews}
                />
              </section>
            </TabPanel>
          ))}
        </Tabs>
      )}
      <Alert className="mt-6 flex gap-3 bg-bg-info-subtle">
        <Info aria-hidden className="size-5 shrink-0 text-icon-info" />
        <div>
          <AlertTitle>{t('joinTitle')}</AlertTitle>
          <AlertDescription>{t('joinBody')}</AlertDescription>
        </div>
      </Alert>
    </>
  );
}
