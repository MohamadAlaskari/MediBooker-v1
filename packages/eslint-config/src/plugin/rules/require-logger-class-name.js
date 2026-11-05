import { staticPropertyName } from '../ast.js';

/**
 * @typedef {import('eslint').Scope.Definition} Definition
 * @typedef {import('../ast.js').NodeOfType<'NewExpression'>} NewExpressionNode
 * @typedef {NewExpressionNode['arguments'][number]} Argument
 * @typedef {Extract<NewExpressionNode['callee'], { type: 'Identifier' }>} Identifier
 */

/** The package whose Logger takes a context. */
const NEST_COMMON = '@nestjs/common';

/** The static methods of Nest's Logger that write a log line. */
const STATIC_LOG_METHODS = new Set(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);

/**
 * Returns the module that an import definition imports from, or null for any other definition
 * and for typescript-eslint's `import x = require('...')`, which has no source.
 * @param {Definition} definition
 * @returns {string | null}
 */
function importSource(definition) {
  if (definition.type !== 'ImportBinding' || definition.parent.type !== 'ImportDeclaration') {
    return null;
  }
  const { value } = definition.parent.source;
  return typeof value === 'string' ? value : null;
}

/**
 * True for `import { Logger } from '@nestjs/common'`, also with an alias.
 * @param {Definition} definition
 * @returns {boolean}
 */
function isNestLoggerImport(definition) {
  if (importSource(definition) !== NEST_COMMON || definition.node.type !== 'ImportSpecifier') {
    return false;
  }
  const { imported } = definition.node;
  return (imported.type === 'Identifier' ? imported.name : imported.value) === 'Logger';
}

/**
 * True for `import * as common from '@nestjs/common'`.
 * @param {Definition} definition
 * @returns {boolean}
 */
function isNestNamespaceImport(definition) {
  return (
    importSource(definition) === NEST_COMMON && definition.node.type === 'ImportNamespaceSpecifier'
  );
}

/**
 * True for a class that the file declares, or for a name that it imports (without type
 * information an imported class cannot be told from another import; a namespace is no class).
 * @param {Definition} definition
 * @returns {boolean}
 */
function isClassDefinition(definition) {
  return (
    definition.type === 'ClassName' ||
    (importSource(definition) !== null && definition.node.type !== 'ImportNamespaceSpecifier')
  );
}

/**
 * A Nest Logger takes the name of the class that logs as its context (02 §8): without one,
 * nestjs-pino logs the last argument of each call as the context, so `logger.log('booked for %s',
 * email)` would log the e-mail address there, and a context that is no class name can carry text
 * that the log-field allowlist lets through. The static methods (`Logger.log(...)`) have no
 * context of their own either. The rule finds Nest's Logger through the file's imports of
 * @nestjs/common, so it needs no type information; other classes named Logger (nestjs-pino's, a
 * local one) are not checked.
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require new Logger(<Class>.name) for Nest's Logger and disallow its static log methods, so the context is the name of the class that logs.",
    },
    messages: {
      className:
        'Create the Nest Logger as new Logger(<Class>.name), with a class that this file declares or imports. Without a context nestjs-pino logs the last argument of each call as the context, and another context can carry personal data (02 §8).',
      staticCall:
        "Nest's static Logger.{{method}}() has no context of its own, so nestjs-pino logs its last argument as the context. Create new Logger(<Class>.name) and call {{method}}() on it (02 §8).",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * Returns the definitions of the variable that the identifier refers to; none for a global or
     * an undeclared name.
     * @param {Identifier} identifier
     * @returns {Definition[]}
     */
    function definitionsOf(identifier) {
      const reference = sourceCode
        .getScope(identifier)
        .references.find((candidate) => candidate.identifier === identifier);
      return reference?.resolved?.defs ?? [];
    }

    /**
     * True for Nest's Logger: `Logger` or an alias imported from @nestjs/common, or `common.Logger`
     * of a namespace import.
     * @param {NewExpressionNode['callee']} callee
     * @returns {boolean}
     */
    function isNestLogger(callee) {
      if (callee.type === 'Identifier') {
        return definitionsOf(callee).some(isNestLoggerImport);
      }
      return (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        staticPropertyName(callee) === 'Logger' &&
        definitionsOf(callee.object).some(isNestNamespaceImport)
      );
    }

    /**
     * True for `<Class>.name` with a class that the file declares or imports.
     * @param {Argument} argument
     * @returns {boolean}
     */
    function isClassName(argument) {
      return (
        argument.type === 'MemberExpression' &&
        !argument.computed &&
        argument.property.type === 'Identifier' &&
        argument.property.name === 'name' &&
        argument.object.type === 'Identifier' &&
        definitionsOf(argument.object).some(isClassDefinition)
      );
    }

    return {
      NewExpression(node) {
        if (!isNestLogger(node.callee)) {
          return;
        }
        const [loggerContext] = node.arguments;
        if (loggerContext === undefined || !isClassName(loggerContext)) {
          context.report({ node: loggerContext ?? node, messageId: 'className' });
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression') {
          return;
        }
        const method = staticPropertyName(callee);
        if (method !== null && STATIC_LOG_METHODS.has(method) && isNestLogger(callee.object)) {
          context.report({ node: callee, messageId: 'staticCall', data: { method } });
        }
      },
    };
  },
};

export default rule;
