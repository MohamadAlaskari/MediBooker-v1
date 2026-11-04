import { jsxAttributeName, nodeType } from '../ast.js';

/** @typedef {import('eslint').Rule.Node} Node */

const CLASS_ATTRIBUTES = new Set(['className', 'class']);
const CLASS_HELPERS = new Set(['cn', 'clsx', 'cva', 'twMerge', 'twJoin', 'tv']);

/**
 * Nodes that pass a class string on unchanged: template literals, arrays, objects (keys and
 * values), `condition && 'class'`, spreads, JSX expression containers and TypeScript
 * wrappers such as `'class' as const`.
 */
const CLASS_VALUE_WRAPPERS = new Set([
  'ArrayExpression',
  'JSXExpressionContainer',
  'LogicalExpression',
  'ObjectExpression',
  'Property',
  'SpreadElement',
  'TemplateLiteral',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
]);

/**
 * Physical Tailwind utilities that exist only with a value (ml-2, left-0) and their logical
 * replacements. They match only as a prefix followed by '-': a bare 'left' is no Tailwind class
 * but, for example, a variant name in cva's defaultVariants.
 */
const VALUE_UTILITIES = new Map([
  ['ml', 'ms'],
  ['mr', 'me'],
  ['pl', 'ps'],
  ['pr', 'pe'],
  ['left', 'start'],
  ['right', 'end'],
  ['scroll-ml', 'scroll-ms'],
  ['scroll-mr', 'scroll-me'],
  ['scroll-pl', 'scroll-ps'],
  ['scroll-pr', 'scroll-pe'],
]);

/**
 * Physical Tailwind utilities that also exist on their own (text-left, border-l) and their
 * logical replacements. They match the whole utility or a prefix followed by '-' (border-l-2),
 * so border-lime-500 and rounded-lg stay valid.
 */
const STANDALONE_UTILITIES = new Map([
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
  ['clear-left', 'clear-start'],
  ['clear-right', 'clear-end'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['rounded-tl', 'rounded-ss'],
  ['rounded-tr', 'rounded-se'],
  ['rounded-bl', 'rounded-es'],
  ['rounded-br', 'rounded-ee'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
]);

/**
 * Offsets of the centring idiom `left-1/2 -translate-x-1/2` (shadcn/ui dialogs use
 * `left-[50%] translate-x-[-50%]`). Together with a horizontal translate they centre the element
 * in left-to-right and right-to-left layouts alike, while `start-1/2` would move it off-centre
 * in right-to-left layouts: translate does not mirror.
 */
const CENTRING_OFFSETS = new Set(['left-1/2', 'left-[50%]', 'right-1/2', 'right-[50%]']);

/**
 * @param {import('../ast.js').NodeOfType<'CallExpression'>} call
 * @returns {boolean}
 */
function isClassHelperCall(call) {
  return call.callee.type === 'Identifier' && CLASS_HELPERS.has(call.callee.name);
}

/**
 * True when a string literal or template element holds class names: it is part of a
 * className/class attribute value or of a class helper argument such as cn('...').
 * Conditions and comparisons such as `side === 'left'` do not hold class names.
 * @param {Node} node
 * @returns {boolean}
 */
function isClassString(node) {
  /** @type {Node} */
  let child = node;
  /** @type {Node | null} */
  let parent = node.parent;
  while (parent !== null) {
    if (parent.type === 'CallExpression') {
      return isClassHelperCall(parent) && parent.arguments.some((argument) => argument === child);
    }
    if (nodeType(parent) === 'JSXAttribute') {
      return CLASS_ATTRIBUTES.has(jsxAttributeName(parent) ?? '');
    }
    const passesClassValue =
      (parent.type === 'ConditionalExpression' && parent.test !== child) ||
      (parent.type === 'BinaryExpression' && parent.operator === '+') ||
      CLASS_VALUE_WRAPPERS.has(parent.type);
    if (!passesClassValue) {
      return false;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/**
 * Returns the length of the variant prefix ('md:hover:'): everything up to the last ':' outside
 * brackets and parentheses, so arbitrary variants such as supports-[display:grid]: count as one.
 * @param {string} className
 * @returns {number}
 */
function variantPrefixLength(className) {
  let depth = 0;
  let length = 0;
  for (let index = 0; index < className.length; index += 1) {
    const char = className.charAt(index);
    if (char === '[' || char === '(') {
      depth += 1;
    } else if ((char === ']' || char === ')') && depth > 0) {
      depth -= 1;
    } else if (char === ':' && depth === 0) {
      length = index + 1;
    }
  }
  return length;
}

/**
 * Splits a class name such as 'md:!-mr-2' into the part before the utility (variants, the
 * important marker '!' and a minus sign), the utility itself and a trailing '!' (Tailwind 4).
 * @param {string} className
 * @returns {{ prefix: string, utility: string, suffix: string }}
 */
function splitClassName(className) {
  let start = variantPrefixLength(className);
  if (className.charAt(start) === '!') {
    start += 1;
  }
  if (className.charAt(start) === '-') {
    start += 1;
  }
  const end = Math.max(start, className.endsWith('!') ? className.length - 1 : className.length);
  return {
    prefix: className.slice(0, start),
    utility: className.slice(start, end),
    suffix: className.slice(end),
  };
}

/**
 * Returns the physical utility that a utility such as 'pl-6' starts with, together with its
 * logical replacement, or null when the utility has no physical direction.
 * @param {string} utility
 * @returns {{ physical: string, logical: string } | null}
 */
function findPhysicalUtility(utility) {
  for (const [physical, logical] of VALUE_UTILITIES) {
    if (utility.startsWith(`${physical}-`)) {
      return { physical, logical };
    }
  }
  for (const [physical, logical] of STANDALONE_UTILITIES) {
    if (utility === physical || utility.startsWith(`${physical}-`)) {
      return { physical, logical };
    }
  }
  return null;
}

/**
 * Returns the logical replacement for a class name with a physical direction, keeping its
 * variants and markers ('md:pl-6' becomes 'md:ps-6'), or null when the class name is fine.
 * @param {string} className
 * @returns {string | null}
 */
function logicalReplacement(className) {
  const { prefix, utility, suffix } = splitClassName(className);
  const match = findPhysicalUtility(utility);
  if (match === null) {
    return null;
  }
  return `${prefix}${match.logical}${utility.slice(match.physical.length)}${suffix}`;
}

/**
 * True for a utility that moves the element horizontally by its own size: translate-x-* and the
 * two-axis translate-* of Tailwind 4, but not translate-y-*, translate-z-* or translate-none.
 * @param {string} utility
 * @returns {boolean}
 */
function isHorizontalTranslate(utility) {
  if (!utility.startsWith('translate-')) {
    return false;
  }
  const value = utility.slice('translate-'.length);
  return !value.startsWith('y-') && !value.startsWith('z-') && value !== 'none';
}

/**
 * Returns the class names of a class list that need a logical replacement. The offsets of the
 * centring idiom stay allowed when the same list also translates the element horizontally.
 * @param {string} classList
 * @returns {{ className: string, replacement: string }[]}
 */
function physicalClassNames(classList) {
  const classNames = classList.split(/\s+/);
  const centresHorizontally = classNames.some((className) =>
    isHorizontalTranslate(splitClassName(className).utility),
  );
  return classNames.flatMap((className) => {
    if (centresHorizontally && CENTRING_OFFSETS.has(splitClassName(className).utility)) {
      return [];
    }
    const replacement = logicalReplacement(className);
    return replacement === null ? [] : [{ className, replacement }];
  });
}

/**
 * Reports physical-direction Tailwind classes and names their logical replacement. The centring
 * idiom (left-1/2 or right-1/2 with a horizontal translate) stays allowed: see CENTRING_OFFSETS.
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical-direction Tailwind classes such as ml-2 or text-left; use logical ones that mirror in right-to-left layouts.',
    },
    messages: {
      physicalDirection:
        "'{{className}}' uses a physical direction and does not mirror in right-to-left layouts. Use '{{replacement}}'.",
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {Node} node
     * @param {string} classList
     */
    function checkClassList(node, classList) {
      for (const { className, replacement } of physicalClassNames(classList)) {
        context.report({
          node,
          messageId: 'physicalDirection',
          data: { className, replacement },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string' && isClassString(node)) {
          checkClassList(node, node.value);
        }
      },
      TemplateElement(node) {
        if (isClassString(node)) {
          checkClassList(node, node.value.cooked ?? node.value.raw);
        }
      },
    };
  },
};

export default rule;
