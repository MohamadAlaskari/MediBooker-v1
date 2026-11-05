import { staticPropertyName } from '../ast.js';
import { typeInformation } from '../type-information.js';

/** @typedef {import('../ast.js').NodeOfType<'CallExpression'>['callee']} Callee */

/** Calls that set bindings, called as a method or a function: pino's and nestjs-pino's. */
const BINDING_CALLS = new Set(['setBindings', 'runInContext']);

/**
 * Methods that set bindings only on a logger: pino's child and nestjs-pino's PinoLogger.assign.
 * On another receiver, such as Object.assign or a domain object's child(), they bind nothing.
 */
const LOGGER_BINDING_METHODS = new Set(['child', 'assign']);

/** The log methods that the loggers with bindings have: pino's Logger and nestjs-pino's PinoLogger. */
const LOGGER_METHODS = ['info', 'error'];

/** pino's option that puts a prefix before every message of a logger. */
const MESSAGE_PREFIX_OPTION = 'msgPrefix';

/**
 * Returns the name of the function or method that a call calls, when the code spells it out.
 * @param {Callee} callee
 * @returns {string | null}
 */
function calledName(callee) {
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  return callee.type === 'MemberExpression' ? staticPropertyName(callee) : null;
}

/**
 * Bindings (child loggers, setBindings, PinoLogger.assign, runInContext) do not pass through the
 * log-field allowlist, and a message prefix is added after the message hook (02 §8). The nest()
 * preset therefore allows them only in src/common/logging, which passes bindings through the
 * allowlist (F04's bindLogFields). Type information tells a logger's child() and assign() from
 * Object.assign and a domain object's methods.
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow log bindings: child loggers, setBindings, a logger's assign, runInContext and the msgPrefix option.",
    },
    messages: {
      binding:
        '{{binding}} binds fields or a message prefix to a logger, which skip the log-field allowlist and the message hook (02 §8). Bind only in src/common/logging, which passes bindings through the allowlist; elsewhere pass reviewed fields to each log call.',
    },
    schema: [],
  },
  create(context) {
    const { checker, tsNodeOf } = typeInformation(context);

    /**
     * True when the value is a logger with bindings: its type has callable info and error members,
     * as pino's Logger and nestjs-pino's PinoLogger have.
     * @param {Extract<Callee, { type: 'MemberExpression' }>['object']} receiver
     * @returns {boolean}
     */
    function isLogger(receiver) {
      const tsReceiver = tsNodeOf(receiver);
      const type = checker.getNonNullableType(checker.getTypeAtLocation(tsReceiver));
      return LOGGER_METHODS.every((name) => {
        const method = type.getProperty(name);
        return (
          method !== undefined &&
          checker.getTypeOfSymbolAtLocation(method, tsReceiver).getCallSignatures().length > 0
        );
      });
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        const name = calledName(callee);
        if (name === null) {
          return;
        }
        const isMethod = callee.type === 'MemberExpression';
        const binds =
          BINDING_CALLS.has(name) ||
          (isMethod && LOGGER_BINDING_METHODS.has(name) && isLogger(callee.object));
        if (binds) {
          context.report({
            node: isMethod ? callee.property : callee,
            messageId: 'binding',
            data: { binding: isMethod ? `.${name}()` : `${name}()` },
          });
        }
      },
      Property(node) {
        if (
          node.parent.type === 'ObjectExpression' &&
          staticPropertyName(node) === MESSAGE_PREFIX_OPTION
        ) {
          context.report({
            node: node.key,
            messageId: 'binding',
            data: { binding: MESSAGE_PREFIX_OPTION },
          });
        }
      },
    };
  },
};

export default rule;
