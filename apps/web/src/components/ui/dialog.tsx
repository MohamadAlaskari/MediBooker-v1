'use client';

import { useId, type ReactNode } from 'react';
import {
  Dialog as DialogPrimitive,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

export { DialogTrigger };

interface DialogContentProps {
  /** Every dialog has a title, which also names it for a screen reader. */
  readonly title: string;
  /** The text below the title, which a screen reader reads out with it when the dialog opens. */
  readonly description?: ReactNode;
  /** False while a request runs: neither Escape nor a press outside may leave it without its answer. */
  readonly isDismissable?: boolean;
  /** Wide for a dialog with columns, such as booking for a patient (W7). */
  readonly size?: 'default' | 'wide';
  readonly children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * The Modal of Figma on React Aria, as `shadcn add dialog` builds it, adapted to the tokens (ADR 0007).
 * React Aria keeps the focus inside, closes on Escape, and gives it back to the trigger.
 */
export function DialogContent({
  title,
  description,
  isDismissable = true,
  size = 'default',
  children,
}: DialogContentProps): ReactNode {
  const descriptionId = useId();
  return (
    <ModalOverlay
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={!isDismissable}
      // On a small or zoomed window the dialog can be taller than the screen, and the page below it
      // cannot scroll: this does. `my-auto` centres it only where there is room, so its top stays.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg-overlay p-4"
    >
      <Modal
        className={cn(
          'my-auto w-full rounded-lg bg-bg-surface p-6 shadow-elevation-2',
          size === 'wide' ? 'max-w-[56rem]' : 'max-w-[28rem]',
        )}
      >
        <DialogPrimitive
          data-slot="dialog"
          // Only a script focuses the dialog itself, when it opens.
          className="flex flex-col gap-4 outline-none"
          {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        >
          {({ close }) => (
            <>
              <Heading slot="title" className="text-heading-h3 text-text-primary">
                {title}
              </Heading>
              {description === undefined ? null : (
                <p id={descriptionId} className="text-body-default text-text-secondary">
                  {description}
                </p>
              )}
              {typeof children === 'function' ? children(close) : children}
            </>
          )}
        </DialogPrimitive>
      </Modal>
    </ModalOverlay>
  );
}
