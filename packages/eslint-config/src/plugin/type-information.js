/**
 * Type information for the rules that need it.
 *
 * typescript-eslint's parser gives a file that it parsed with a TypeScript program (the project
 * service of the base() preset) the program and a map from each syntax node to its TypeScript
 * node. ESLint types these parser services as `any`; TypedParserServices names the two members
 * that the rules read.
 */

/**
 * @typedef {object} TypedParserServices
 * @property {import('typescript').Program | null} program null when the file has no program
 * @property {{ get(node: object): import('typescript').Node | undefined }} esTreeNodeToTSNodeMap
 */

/**
 * @typedef {object} TypeInformation
 * @property {import('typescript').TypeChecker} checker
 * @property {(node: object) => import('typescript').Node} tsNodeOf returns the TypeScript node of
 *   a syntax node of the linted file
 */

/**
 * Returns the type checker of the linted file's program and a function that finds the TypeScript
 * node of a syntax node. Throws when the file was parsed without type information, so a typed rule
 * that is configured for such a file fails the lint run instead of passing every file.
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {TypeInformation}
 */
export function typeInformation(context) {
  const services = /** @type {Partial<TypedParserServices> | null | undefined} */ (
    context.sourceCode.parserServices
  );
  const program = services?.program;
  const nodeMap = services?.esTreeNodeToTSNodeMap;
  if (!program || !nodeMap) {
    throw new Error(
      `${context.id} needs type information for ${context.filename}: lint TypeScript files with typescript-eslint's parser and the project service, as the base() preset does.`,
    );
  }
  return {
    checker: program.getTypeChecker(),
    tsNodeOf(node) {
      const tsNode = nodeMap.get(node);
      if (tsNode === undefined) {
        throw new Error(`${context.id}: the syntax node has no TypeScript node`);
      }
      return tsNode;
    },
  };
}
