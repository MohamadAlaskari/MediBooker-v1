import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, LinkButton } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger } from './select';
import { Tab, TabList, TabPanel, Tabs } from './tabs';
import { PasswordField, TextAreaField, TextField } from './text-field';

function classListsOf(html: string): readonly string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].map(([, classes]) => classes ?? '');
}

const WITH_A_RING: readonly (readonly [string, ReactNode])[] = [
  ['a button', <Button key="button">Send</Button>],
  [
    'a link button',
    <LinkButton key="link" href="/en">
      Go
    </LinkButton>,
  ],
  [
    'a tab and its panel',
    <Tabs key="tabs">
      <TabList aria-label="Tabs">
        <Tab id="one">One</Tab>
      </TabList>
      <TabPanel id="one">Panel</TabPanel>
    </Tabs>,
  ],
  ['a text field', <TextField key="text" label="Name" />],
  ['a text area', <TextAreaField key="area" label="Note" />],
  ['a password field', <PasswordField key="secret" label="Key" showLabel="S" hideLabel="H" />],
  [
    'a select',
    <Select key="select" aria-label="Service">
      <SelectTrigger />
      <SelectContent>
        <SelectItem id="one">One</SelectItem>
      </SelectContent>
    </Select>,
  ],
];

describe('the focus ring', () => {
  // Axe cannot see this: `outline-none` sets --tw-outline-style, which `outline-2` then reads.
  it.each(WITH_A_RING)('of %s is not hidden by its own classes', (_name, element) => {
    const lists = classListsOf(renderToStaticMarkup(element));
    expect(lists.filter((classes) => classes.includes(':outline-2')).length).toBeGreaterThan(0);
    expect(
      lists.filter((classes) => classes.includes(':outline-2') && classes.includes('outline-none')),
    ).toEqual([]);
  });
});

describe('a button with a running request', () => {
  const html = renderToStaticMarkup(<Button isPending>Send</Button>);

  it('stays focusable, because a disabled one drops the focus to the page', () => {
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).toContain('aria-disabled="true"');
  });

  it('looks as if it waits', () => {
    expect(html).toContain('data-pending="true"');
    expect(html).toContain('data-[pending]:bg-bg-disabled');
  });

  it('is disabled only when asked for that', () => {
    expect(renderToStaticMarkup(<Button isDisabled>Send</Button>)).toMatch(/\sdisabled(=|\s|>)/);
  });

  it('does not send a form again', () => {
    const waiting = renderToStaticMarkup(
      <Button type="submit" isPending>
        Send
      </Button>,
    );
    expect(waiting).toContain('type="button"');
  });
});
