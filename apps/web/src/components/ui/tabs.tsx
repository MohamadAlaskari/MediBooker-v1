'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  Tab as TabPrimitive,
  TabList as TabListPrimitive,
  TabPanel as TabPanelPrimitive,
  Tabs as TabsPrimitive,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

/** The Tab of Figma on React Aria, as `shadcn add tabs` builds it, adapted to the tokens (ADR 0007). */
export function Tabs({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive>, 'className'> & {
  readonly className?: string;
}): ReactNode {
  return (
    <TabsPrimitive data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />
  );
}

export function TabList({
  ...props
}: Omit<ComponentProps<typeof TabListPrimitive>, 'className'>): ReactNode {
  return (
    <TabListPrimitive
      data-slot="tab-list"
      className="flex gap-2 border-b border-border-subtle"
      {...props}
    />
  );
}

export function Tab({
  ...props
}: Omit<ComponentProps<typeof TabPrimitive>, 'className'>): ReactNode {
  return (
    <TabPrimitive
      data-slot="tab"
      className="-mb-px flex min-h-touch-target cursor-default items-center border-b-2 border-transparent px-4 text-label-default text-text-secondary data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-border-focus data-[hovered]:text-text-primary data-[selected]:border-border-brand data-[selected]:text-text-brand"
      {...props}
    />
  );
}

export function TabPanel({
  ...props
}: Omit<ComponentProps<typeof TabPanelPrimitive>, 'className'>): ReactNode {
  return (
    <TabPanelPrimitive
      data-slot="tab-panel"
      className="data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-border-focus"
      {...props}
    />
  );
}
