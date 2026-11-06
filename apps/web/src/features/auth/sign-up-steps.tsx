import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STEPS = ['account', 'verify'] as const;

interface SignUpStepsProps {
  readonly current: (typeof STEPS)[number];
}

/** The Step component of Figma: where a person is on the way to an account. */
export function SignUpSteps({ current }: SignUpStepsProps): ReactNode {
  const t = useTranslations('auth.signUp');
  const position = STEPS.indexOf(current);
  const labels = { account: t('stepAccount'), verify: t('stepVerify') };
  return (
    <ol
      aria-label={t('steps', { current: position + 1, total: STEPS.length })}
      className="mb-6 flex items-center gap-4"
    >
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === position ? 'step' : undefined}
          className="flex items-center gap-2 text-label-default text-text-primary"
        >
          <span
            aria-hidden
            className={cn(
              'flex size-8 items-center justify-center rounded-full border text-label-small',
              index === position && 'border-border-brand bg-bg-brand text-text-on-brand',
              index < position && 'border-transparent bg-bg-brand-subtle text-text-brand',
              index > position && 'border-border-strong text-text-secondary',
            )}
          >
            {index < position ? <Check className="size-4" /> : index + 1}
          </span>
          {labels[step]}
        </li>
      ))}
    </ol>
  );
}
