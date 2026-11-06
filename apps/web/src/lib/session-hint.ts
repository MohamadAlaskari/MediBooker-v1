/**
 * Readable by the page and sent with every page request: that a sign-in probably exists. It protects
 * nothing, because the API decides about every request.
 */
export const SESSION_HINT_COOKIE = 'mb_csrf';
