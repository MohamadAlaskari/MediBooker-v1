import rule from '../../src/plugin/rules/no-physical-direction-classes.js';
import { ruleTester } from './rule-tester.js';

function physicalDirection(className: string, replacement: string) {
  return { messageId: 'physicalDirection', data: { className, replacement } };
}

ruleTester.run('no-physical-direction-classes', rule, {
  valid: [
    'const box = <div className="ms-4 pe-2 start-0 text-start mx-auto px-4 inset-x-0 place-items-center prose" />;',
    'const box = <div className="border-lime-500 border-red-500 rounded-lg" />;',
    "const classes = cn('ms-2', isOpen && 'pe-4');",
    // Not class names: a plain string, a comparison and another attribute.
    "const side = 'left';",
    "const classes = cn(side === 'left' && 'ms-2');",
    'const box = <div data-side="left" />;',
    "const classes = merge('ml-2');",
    // Variant names: a bare 'left' or 'right' is no Tailwind class (left-0 is).
    "const sheet = cva('fixed', { variants: { side: { left: 'start-0', right: 'end-0' } }, defaultVariants: { side: 'right' } });",
    "const sheet = tv({ base: 'fixed', compoundVariants: [{ side: 'left', class: 'ps-2' }] });",
    // The centring idiom: translate does not mirror, so start-1/2 would be off-centre in RTL.
    'const dialog = <div className="fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]" />;',
    'const badge = <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />;',
    "const popover = cn('absolute right-1/2 translate-x-1/2');",
    // Tailwind 4's two-axis translate moves the element horizontally as well.
    'const dot = <span className="absolute left-1/2 top-1/2 -translate-1/2" />;',
  ],
  invalid: [
    {
      code: 'const box = <div className="ml-2" />;',
      errors: [physicalDirection('ml-2', 'ms-2')],
    },
    {
      code: 'const box = <div className="md:pl-6" />;',
      errors: [physicalDirection('md:pl-6', 'md:ps-6')],
    },
    {
      code: 'const box = <div className="-mr-2" />;',
      errors: [physicalDirection('-mr-2', '-me-2')],
    },
    {
      code: 'const box = <div className="!pr-2" />;',
      errors: [physicalDirection('!pr-2', '!pe-2')],
    },
    {
      code: 'const box = <div className="pr-2!" />;',
      errors: [physicalDirection('pr-2!', 'pe-2!')],
    },
    {
      code: "const classes = cn('px-2', cond && 'ml-2');",
      errors: [physicalDirection('ml-2', 'ms-2')],
    },
    {
      code: "const classes = clsx({ 'pl-2': a });",
      errors: [physicalDirection('pl-2', 'ps-2')],
    },
    {
      code: "const button = cva('base', { variants: { s: { sm: 'mr-1' } } });",
      errors: [physicalDirection('mr-1', 'me-1')],
    },
    {
      code: 'const box = <div className={`ml-${n}`} />;',
      errors: [physicalDirection('ml-', 'ms-')],
    },
    {
      code: 'const box = <div class="text-left float-right" />;',
      errors: [
        physicalDirection('text-left', 'text-start'),
        physicalDirection('float-right', 'float-end'),
      ],
    },
    {
      code: "const classes = twMerge('rounded-tl-lg border-l-2');",
      errors: [
        physicalDirection('rounded-tl-lg', 'rounded-ss-lg'),
        physicalDirection('border-l-2', 'border-s-2'),
      ],
    },
    {
      code: "const card = tv({ base: 'left-0 right-4' });",
      errors: [physicalDirection('left-0', 'start-0'), physicalDirection('right-4', 'end-4')],
    },
    {
      // The classes are reported, the variant name 'left' is not.
      code: "const sheet = cva('fixed', { variants: { side: { left: 'left-0 border-r' } }, defaultVariants: { side: 'left' } });",
      errors: [physicalDirection('left-0', 'start-0'), physicalDirection('border-r', 'border-e')],
    },
    {
      code: "const classes = twJoin('scroll-pl-4 clear-left rounded-r');",
      errors: [
        physicalDirection('scroll-pl-4', 'scroll-ps-4'),
        physicalDirection('clear-left', 'clear-start'),
        physicalDirection('rounded-r', 'rounded-e'),
      ],
    },
    {
      // Reported once each, although the strings sit in both a className and a cn() call.
      code: "const box = <div className={cn('px-2', isRtl ? 'ml-2' : 'mr-2')} />;",
      errors: [physicalDirection('ml-2', 'ms-2'), physicalDirection('mr-2', 'me-2')],
    },
    {
      code: 'const box = <div className="supports-[display:grid]:pl-2 hover:md:!-ml-1" />;',
      errors: [
        physicalDirection('supports-[display:grid]:pl-2', 'supports-[display:grid]:ps-2'),
        physicalDirection('hover:md:!-ml-1', 'hover:md:!-ms-1'),
      ],
    },
    {
      // A half offset without a translate is a plain offset, not the centring idiom.
      code: 'const panel = <div className="absolute left-1/2 w-1/2" />;',
      errors: [physicalDirection('left-1/2', 'start-1/2')],
    },
    {
      // A vertical translate does not centre horizontally.
      code: 'const panel = <div className="absolute left-1/2 -translate-y-1/2" />;',
      errors: [physicalDirection('left-1/2', 'start-1/2')],
    },
    {
      // With a translate, only the half offsets are allowed; other offsets are still reported.
      code: 'const close = <button className="absolute top-4 right-4 -translate-x-1/2" />;',
      errors: [physicalDirection('right-4', 'end-4')],
    },
  ],
});
