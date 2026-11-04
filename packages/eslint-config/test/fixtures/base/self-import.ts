// Synthetic violation: the resolver must map './self-import.js' to this .ts file.
import * as self from './self-import.js';

export const answer = 42;
export const sameAnswer = self.answer;
