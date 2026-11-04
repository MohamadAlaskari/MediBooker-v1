import { jsxAttributeName, nodeType } from '../ast.js';

/**
 * A hex colour literal (#rgb, #rgba, #rrggbb, #rrggbbaa) that is not part of a word, of an
 * id such as #abc-def, or of an HTML entity such as &#123;. Group 1 is the colour.
 */
const HEX_COLOR =
  /(?:^|[^&\w])(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))(?![\w-])/;

/**
 * True when the string is the value of a JSX href attribute: an in-page link such as
 * href="#add" is not a colour.
 * @param {import('eslint').Rule.Node} node a Literal or a TemplateElement
 * @returns {boolean}
 */
function isJsxHrefValue(node) {
  const value = node.type === 'TemplateElement' ? node.parent : node;
  let parent = value.parent;
  if (nodeType(parent) === 'JSXExpressionContainer') {
    parent = parent?.parent ?? null;
  }
  return jsxAttributeName(parent) === 'href';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hex colour literals in UI code; colours come from design tokens.',
    },
    messages: {
      hexColor: "Hex colour '{{color}}': use a design token (a CSS variable or a theme value).",
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import('eslint').Rule.Node} node
     * @param {string} text
     */
    function check(node, text) {
      const color = HEX_COLOR.exec(text)?.[1];
      if (color !== undefined && !isJsxHrefValue(node)) {
        context.report({ node, messageId: 'hexColor', data: { color } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default rule;
