'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from './button';

interface SheetProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** Above the title, in small letters: what kind of view this is. */
  readonly kicker?: string;
  /** Names the sheet for a screen reader too. */
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
}

/**
 * The drawer of Figma (W6) on React Aria's modal: at the end of the reading direction, over the
 * page, with the focus kept inside, Escape to close, and the focus back where it came from.
 */
export function Sheet({
  isOpen,
  onOpenChange,
  kicker,
  title,
  closeLabel,
  children,
}: SheetProps): ReactNode {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 bg-bg-overlay"
    >
      <Modal className="fixed inset-y-0 end-0 w-full max-w-[40rem] overflow-y-auto bg-bg-surface shadow-elevation-2">
        <DialogPrimitive data-slot="sheet" className="flex min-h-full flex-col outline-none">
          <div className="flex items-start gap-4 border-b border-border-subtle px-6 py-5">
            <div className="min-w-0 flex-1">
              {kicker === undefined ? null : (
                <p className="text-body-small text-text-secondary">{kicker}</p>
              )}
              <Heading slot="title" className="text-heading-h3 text-text-primary">
                {title}
              </Heading>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={closeLabel}
              onPress={() => {
                onOpenChange(false);
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
          <div className="flex flex-1 flex-col gap-6 px-6 py-6">{children}</div>
        </DialogPrimitive>
      </Modal>
    </ModalOverlay>
  );
}
