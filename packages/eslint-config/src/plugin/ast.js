/**
 * Read-only helpers for syntax nodes that ESLint's types do not describe.
 *
 * ESLint types the ESTree nodes only. The TypeScript parser also produces JSX nodes
 * (JSXAttribute, JSXExpressionContainer) and TypeScript nodes (TSAsExpression, ...),
 * so the rules compare those node types as plain strings and read JSX attribute names here.
 */

/**
 * An ESTree node of the given type, including the `parent` that ESLint adds.
 * @template {string} Type
 * @typedef {Extract<import('eslint').Rule.Node, { type: Type }>} NodeOfType
 */

/**
 * Returns the node's type as a plain string, so JSX and TypeScript node types can be compared.
 * @param {{ type: string } | null} node
 * @returns {string | null}
 */
export function nodeType(node) {
  return node === null ? null : node.type;
}

/**
 * Returns the name of a JSX attribute (`className` for `className="..."`), or null for any
 * other node and for namespaced names such as `xlink:href`.
 * @param {{ type: string } | null} node
 * @returns {string | null}
 */
export function jsxAttributeName(node) {
  if (node?.type !== 'JSXAttribute') {
    return null;
  }
  // A JSXAttribute always has a name: a JSXIdentifier or a JSXNamespacedName.
  const { name } = /** @type {{ type: string, name: { type: string, name?: unknown } }} */ (node);
  return name.type === 'JSXIdentifier' && typeof name.name === 'string' ? name.name : null;
}
