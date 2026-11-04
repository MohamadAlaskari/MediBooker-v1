/**
 * @typedef {import('../ast.js').NodeOfType<'MemberExpression'>} MemberExpressionNode
 * @typedef {MemberExpressionNode['object']} ExpressionNode
 */

/**
 * @param {ExpressionNode} node
 * @param {string} name
 * @returns {boolean}
 */
function isIdentifierNamed(node, name) {
  return node.type === 'Identifier' && node.name === name;
}

/**
 * Returns the property name of `object.name` and `object['name']`, otherwise null.
 * @param {MemberExpressionNode} node
 * @returns {string | null}
 */
function propertyName(node) {
  const { property } = node;
  if (!node.computed && property.type === 'Identifier') {
    return property.name;
  }
  if (property.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }
  return null;
}

/**
 * Domain rules must be deterministic and testable, so they get the time from an injected
 * Clock. The name check is deliberate: an imported Temporal polyfill reads the clock too.
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow reading the system clock in domain code; inject the Clock instead.',
    },
    messages: {
      systemClock:
        '{{read}} reads the system clock. Inject the Clock and call clock.now(), so the rule stays testable.',
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import('eslint').Rule.Node} node
     * @param {string} read
     */
    function report(node, read) {
      context.report({ node, messageId: 'systemClock', data: { read } });
    }

    return {
      NewExpression(node) {
        if (isIdentifierNamed(node.callee, 'Date') && node.arguments.length === 0) {
          report(node, 'new Date()');
        }
      },
      CallExpression(node) {
        // Date() without `new` ignores its arguments and returns the current time as text.
        if (isIdentifierNamed(node.callee, 'Date')) {
          report(node, 'Date()');
        }
      },
      MemberExpression(node) {
        const property = propertyName(node);
        if (isIdentifierNamed(node.object, 'Date') && property === 'now') {
          report(node, 'Date.now');
        } else if (isIdentifierNamed(node.object, 'Temporal') && property === 'Now') {
          report(node, 'Temporal.Now');
        }
      },
    };
  },
};

export default rule;
