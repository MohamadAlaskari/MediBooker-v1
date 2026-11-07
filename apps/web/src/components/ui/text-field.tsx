'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactNode, type Ref } from 'react';
import {
  FieldError,
  Group,
  Input,
  Label,
  Text,
  TextArea,
  TextField as TextFieldPrimitive,
  type TextFieldProps as TextFieldPrimitiveProps,
} from 'react-aria-components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FIELD = 'grid grid-cols-1 gap-1 text-start';
const LABEL = 'text-label-default text-text-primary';
const HINT = 'text-body-small text-text-secondary';
const ERROR = 'text-body-small text-text-danger';
const CONTROL =
  'min-h-touch-target rounded-md border border-border-strong bg-bg-surface text-body-default text-text-primary';
const FOCUS_RING =
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-border-focus';

interface TextFieldProps extends Omit<TextFieldPrimitiveProps, 'className' | 'children'> {
  readonly label: string;
  readonly hint?: string | undefined;
  /** Translated, and shown as long as it is set. */
  readonly error?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly autoComplete?: string;
  readonly inputMode?: 'email' | 'text' | 'tel';
  readonly className?: string;
}

/** The Text Field of Figma, on React Aria (ADR 0007): the label, hint and error are all linked. */
export function TextField({
  label,
  hint,
  error,
  inputRef,
  autoComplete,
  inputMode,
  className,
  ...props
}: TextFieldProps): ReactNode {
  return (
    <TextFieldPrimitive
      data-slot="text-field"
      validationBehavior="aria"
      isInvalid={error !== undefined}
      className={cn(FIELD, className)}
      {...props}
    >
      <Label className={LABEL}>{label}</Label>
      <Input
        ref={inputRef}
        autoComplete={autoComplete}
        inputMode={inputMode}
        // A browser's spell check can send what is typed to a service. Nothing here needs it.
        spellCheck={false}
        className={cn(CONTROL, FOCUS_RING, 'w-full px-3 data-[invalid]:border-border-danger')}
      />
      {hint === undefined ? null : (
        <Text slot="description" className={HINT}>
          {hint}
        </Text>
      )}
      <FieldError className={ERROR}>{error}</FieldError>
    </TextFieldPrimitive>
  );
}

interface TextAreaFieldProps extends Omit<
  TextFieldProps,
  'inputRef' | 'autoComplete' | 'inputMode'
> {
  /** For a page that moves the focus here, when the API refuses what was written. */
  readonly inputRef?: Ref<HTMLTextAreaElement> | undefined;
}

/** The same field over several lines. */
export function TextAreaField({
  label,
  hint,
  error,
  inputRef,
  className,
  ...props
}: TextAreaFieldProps): ReactNode {
  return (
    <TextFieldPrimitive
      data-slot="text-area-field"
      validationBehavior="aria"
      isInvalid={error !== undefined}
      className={cn(FIELD, className)}
      {...props}
    >
      <Label className={LABEL}>{label}</Label>
      <TextArea
        ref={inputRef}
        spellCheck={false}
        rows={4}
        className={cn(CONTROL, FOCUS_RING, 'w-full px-3 py-2 data-[invalid]:border-border-danger')}
      />
      {hint === undefined ? null : (
        <Text slot="description" className={HINT}>
          {hint}
        </Text>
      )}
      <FieldError className={ERROR}>{error}</FieldError>
    </TextFieldPrimitive>
  );
}

interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'inputMode'> {
  readonly showLabel: string;
  readonly hideLabel: string;
}

/** A password field whose text can be shown, so a long passphrase can be checked before sending. */
export function PasswordField({
  label,
  hint,
  error,
  inputRef,
  autoComplete,
  showLabel,
  hideLabel,
  className,
  ...props
}: PasswordFieldProps): ReactNode {
  const [shown, setShown] = useState(false);
  return (
    <TextFieldPrimitive
      data-slot="password-field"
      type={shown ? 'text' : 'password'}
      validationBehavior="aria"
      isInvalid={error !== undefined}
      className={cn(FIELD, className)}
      {...props}
    >
      <Label className={LABEL}>{label}</Label>
      <Group
        className={cn(
          CONTROL,
          'flex items-center has-[input[data-focused]]:outline-2 has-[input[data-focused]]:outline-offset-2 has-[input[data-focused]]:outline-border-focus data-[invalid]:border-border-danger',
        )}
      >
        <Input
          ref={inputRef}
          autoComplete={autoComplete}
          // A password has no spelling or capitals to correct, in any language.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // The group around it draws the ring, around the button too.
          className="min-h-touch-target min-w-0 flex-1 rounded-md bg-transparent px-3 outline-none"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          onPress={() => {
            setShown(!shown);
          }}
        >
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </Group>
      {hint === undefined ? null : (
        <Text slot="description" className={HINT}>
          {hint}
        </Text>
      )}
      <FieldError className={ERROR}>{error}</FieldError>
    </TextFieldPrimitive>
  );
}
