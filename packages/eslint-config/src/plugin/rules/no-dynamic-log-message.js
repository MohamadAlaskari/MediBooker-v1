import ts from 'typescript';
import { staticPropertyName } from '../ast.js';
import { typeInformation } from '../type-information.js';

/**
 * @typedef {import('eslint').Rule.Node} Node
 * @typedef {import('../ast.js').MemberExpression} MemberExpression
 * @typedef {import('../ast.js').NodeOfType<'CallExpression'>} CallExpressionNode
 * @typedef {CallExpressionNode['arguments'][number]} Argument
 * @typedef {{ argument: Argument, message: Argument | null }} LogCallArgument
 */

/** The methods that write a log line in Nest's Logger and LoggerService, pino and nestjs-pino. */
const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'verbose', 'fatal', 'trace']);

/**
 * The parameter that takes the message, by its name in the installed declarations: `message` in
 * Nest's Logger and LoggerService (so also in nestjs-pino's Logger), `msg` in pino's LogFn and in
 * nestjs-pino's PinoLogger. A method without one, such as Math.log(x) or a domain object's
 * error(code), is no logger.
 */
const MESSAGE_PARAMETERS = new Set(['message', 'msg']);

/** The properties that hold an error's text: the message, and the stack, whose header repeats it. */
const ERROR_TEXT_PROPERTIES = new Set(['message', 'stack']);

/**
 * The types whose values pino takes as the object of a log line: objects, null, undefined and
 * void. pino takes a first argument of any other type as the message (`logger.info(42)`).
 */
const OBJECT_ARGUMENT_FLAGS =
  ts.TypeFlags.Object |
  ts.TypeFlags.NonPrimitive |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void;

/**
 * True for a message that is text written in code: a string literal or a template literal without
 * expressions.
 * @param {Argument} message
 * @returns {boolean}
 */
function isConstantMessage(message) {
  return (
    (message.type === 'Literal' && typeof message.value === 'string') ||
    (message.type === 'TemplateLiteral' && message.expressions.length === 0)
  );
}

/**
 * True when every value of the type is an object, null or undefined, so pino takes the argument as
 * the object of the log line. A type parameter counts by its constraint. Each member of a union or
 * an intersection must be such a type: `string & { brand: 'Id' }` is a string at runtime.
 * @param {import('typescript').Type} type
 * @param {import('typescript').TypeChecker} checker
 * @returns {boolean}
 */
function isObjectArgumentType(type, checker) {
  if (type.isUnionOrIntersection()) {
    return type.types.every((member) => isObjectArgumentType(member, checker));
  }
  if ((type.flags & ts.TypeFlags.InstantiableNonPrimitive) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return (
      constraint !== undefined && constraint !== type && isObjectArgumentType(constraint, checker)
    );
  }
  return (type.flags & OBJECT_ARGUMENT_FLAGS) !== 0;
}

/**
 * The message of a log line is text written in code, and a log call never logs an error's message
 * or stack (02 §8): both can carry personal data, and at runtime a message built from a value
 * cannot be told from a constant. Type information decides whether a call is a logger call and
 * which argument is its message; the method name alone would also match Math.log(x).
 * Interpolation values after a constant message stay allowed: the logger's message hook drops them.
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require a constant message in logger calls and disallow logging an error's message or stack.",
    },
    messages: {
      dynamicMessage:
        "Log a constant message: a string literal or a template literal without expressions. A message built at runtime can carry personal data, and the logger cannot tell it from a constant (02 §8). Nest's Logger takes a constant message only; log an error or reviewed fields through nestjs-pino's PinoLogger or req.log, as logger.error({ err }, 'booking failed').",
      errorText:
        "Do not log an error's {{property}}: it can carry personal data. Pass the error as { err } with a constant message through nestjs-pino's PinoLogger or req.log, as logger.error({ err }, 'booking failed'), so the error serializer decides what is logged (02 §8).",
    },
    schema: [],
  },
  create(context) {
    const { checker, tsNodeOf } = typeInformation(context);

    /**
     * True when the callee names a log method: `logger.info`, `logger['info']`, or
     * `logger[level]` with a key whose type allows log method names only.
     * @param {MemberExpression} callee
     * @returns {boolean}
     */
    function isLogMethod(callee) {
      const name = staticPropertyName(callee);
      if (name !== null || !callee.computed) {
        return name !== null && LOG_METHODS.has(name);
      }
      const keyType = checker.getTypeAtLocation(tsNodeOf(callee.property));
      const keys = keyType.isUnion() ? keyType.types : [keyType];
      return keys.every((key) => key.isStringLiteral() && LOG_METHODS.has(key.value));
    }

    /**
     * Returns the position of the message parameter in the signature that the call resolves to,
     * or -1 when the call is no logger call.
     * @param {CallExpressionNode} call
     * @returns {number}
     */
    function messageParameterIndex(call) {
      const { callee } = call;
      if (callee.type !== 'MemberExpression' || !isLogMethod(callee)) {
        return -1;
      }
      const tsCall = /** @type {import('typescript').CallExpression} */ (tsNodeOf(call));
      const parameters = checker.getResolvedSignature(tsCall)?.getParameters() ?? [];
      return parameters.findIndex((parameter) => MESSAGE_PARAMETERS.has(parameter.getName()));
    }

    /**
     * Returns the argument that a logger call passes as its message, or null when it passes none.
     * Nest's Logger takes the message first. pino and nestjs-pino's PinoLogger take the object of
     * the line first and the message after it, but pino takes a first argument that is not an
     * object, null or undefined as the message itself: such a first argument (a number, a
     * string-typed value, `unknown`) is the message. A spread at or before the message's position
     * hides which value becomes the message, so the spread counts as the message.
     * @param {CallExpressionNode} call
     * @param {number} messageIndex the position of the message parameter
     * @returns {Argument | null}
     */
    function messageArgument(call, messageIndex) {
      const args = call.arguments;
      const spread = args
        .slice(0, messageIndex + 1)
        .find((argument) => argument.type === 'SpreadElement');
      if (spread !== undefined) {
        return spread;
      }
      const [first] = args;
      if (
        messageIndex > 0 &&
        first !== undefined &&
        !isObjectArgumentType(checker.getTypeAtLocation(tsNodeOf(first)), checker)
      ) {
        return first;
      }
      return args[messageIndex] ?? null;
    }

    /**
     * Returns the argument of the innermost logger call that contains the node, with that call's
     * message; null when the node is in no argument of a logger call.
     * @param {Node} node
     * @returns {LogCallArgument | null}
     */
    function enclosingLogCallArgument(node) {
      /** @type {Node} */
      let child = node;
      /** @type {Node | null} */
      let parent = node.parent;
      while (parent !== null) {
        if (parent.type === 'CallExpression') {
          const argument = parent.arguments.find((candidate) => candidate === child);
          const messageIndex = argument === undefined ? -1 : messageParameterIndex(parent);
          if (argument !== undefined && messageIndex !== -1) {
            return { argument, message: messageArgument(parent, messageIndex) };
          }
        }
        child = parent;
        parent = parent.parent;
      }
      return null;
    }

    return {
      CallExpression(node) {
        const messageIndex = messageParameterIndex(node);
        const message = messageIndex === -1 ? null : messageArgument(node, messageIndex);
        if (message !== null && !isConstantMessage(message)) {
          context.report({ node: message, messageId: 'dynamicMessage' });
        }
      },
      MemberExpression(node) {
        const property = staticPropertyName(node);
        if (property === null || !ERROR_TEXT_PROPERTIES.has(property)) {
          return;
        }
        const enclosing = enclosingLogCallArgument(node);
        // A read inside the message makes it a dynamic message, which is reported already.
        if (enclosing !== null && enclosing.argument !== enclosing.message) {
          context.report({ node, messageId: 'errorText', data: { property } });
        }
      },
    };
  },
};

export default rule;
