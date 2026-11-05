/**
 * Read-only helpers for syntax nodes, shared by the rules.
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
 * A member expression and an object literal property as ESLint types them inside another node,
 * without `parent` (a node that a rule receives directly is assignable to them).
 * @typedef {Extract<NodeOfType<'CallExpression'>['callee'], { type: 'MemberExpression' }>} MemberExpression
 * @typedef {Extract<NodeOfType<'ObjectExpression'>['properties'][number], { type: 'Property' }>} Property
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

/**
 * Returns the name of the property that a member expression reads, or of an object literal's key,
 * when the code spells it out: `name` for `object.name`, `object['name']`, `` object[`name`] ``,
 * `{ name: value }`, `{ name }` and `{ 'name': value }`. Returns null for a name computed at
 * runtime and for a private name such as `this.#name`.
 * @param {MemberExpression | Property} node
 * @returns {string | null}
 */
export function staticPropertyName(node) {
  const key = node.type === 'MemberExpression' ? node.property : node.key;
  if (!node.computed && key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal') {
    return typeof key.value === 'string' ? key.value : null;
  }
  if (node.computed && key.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? null;
  }
  return null;
}
