/**
 * The environment of a child process in a test: the parent's, with the given variables on top and
 * without the settings known to add output to a child: the debug switches of Node, the `debug`
 * package, the Azure SDK and Nest, and `NODE_EXTRA_CA_CERTS` (Node warns on stderr when its file
 * cannot be read; the children open no TLS connection).
 */
export function childEnv(variables: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_OPTIONS: '',
    DEBUG: '',
    NODE_DEBUG: '',
    NODE_DEBUG_NATIVE: '',
    AZURE_LOG_LEVEL: '',
    NEST_DEBUG: '',
    NODE_EXTRA_CA_CERTS: '',
    ...variables,
  };
}
