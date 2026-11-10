/**
 * The one reader of an Azure Storage connection string: the environment validates with it and the
 * adapter gets its result, so nothing can read a string differently from what was checked. The SDK
 * never sees the string, and this file imports nothing from it.
 */

/** Lowercase letters and digits, as Azure names accounts. A derived endpoint holds it as its host. */
const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;

/** Canonical base64: the SDK decodes anything, and a wrong key would only show as a refused request. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** A plain host name or IPv4 address. */
const PLAIN_HOST = /^[A-Za-z0-9.-]+$/;

const DEFAULT_ENDPOINT_SUFFIX = 'core.windows.net';

export interface AzureConnection {
  readonly accountName: string;
  readonly accountKey: string;
  readonly blobEndpoint: string;
}

/** Why a string was refused. These names reach the error output, the values never do. */
export type AzureConnectionProblem =
  | 'not_a_connection_string'
  | 'shared_access_signature_cannot_sign'
  | 'development_shortcut_points_at_loopback'
  | 'account_name_invalid'
  | 'account_key_invalid'
  | 'blob_endpoint_invalid';

/** The settings of a string; undefined when one has no name or a name comes twice. */
function settingsOf(value: string): ReadonlyMap<string, string> | undefined {
  const settings = new Map<string, string>();
  for (const part of value.split(';')) {
    const segment = part.trim();
    if (segment === '') continue;
    // A value may hold `=`, as base64 padding does: only the first one separates.
    const separator = segment.indexOf('=');
    const name = segment.slice(0, Math.max(separator, 0));
    // The SDK takes the first of two, other readers the last: nobody gets to choose.
    if (name === '' || settings.has(name)) return undefined;
    settings.set(name, segment.slice(separator + 1));
  }
  return settings;
}

/**
 * A blob endpoint in its one written form, without a trailing slash; undefined when it is no http or
 * https URL with a plain host, or holds a login, a query or a fragment. What goes on from here is this
 * form, not what was written.
 */
export function blobUrlOf(value: string): string | undefined {
  if (!URL.canParse(value) || value.includes('?') || value.includes('#')) return undefined;
  const { protocol, hostname, username, password, origin, pathname } = new URL(value);
  const isPlain =
    (protocol === 'https:' || protocol === 'http:') &&
    PLAIN_HOST.test(hostname) &&
    username === '' &&
    password === '';
  return isPlain ? `${origin}${pathname.replace(/\/+$/, '')}` : undefined;
}

function blobEndpointOf(
  settings: ReadonlyMap<string, string>,
  accountName: string,
): string | undefined {
  const written = settings.get('BlobEndpoint');
  if (written !== undefined) return blobUrlOf(written);
  const protocol = settings.get('DefaultEndpointsProtocol');
  const suffix = settings.get('EndpointSuffix') ?? DEFAULT_ENDPOINT_SUFFIX;
  if ((protocol !== 'https' && protocol !== 'http') || !PLAIN_HOST.test(suffix)) return undefined;
  return `${protocol}://${accountName}.blob.${suffix}`;
}

/**
 * The account, its key and its blob endpoint, or why the string cannot be used. Endpoints of other
 * services and unknown settings are ignored.
 */
export function parseAzureConnectionString(
  value: string,
): AzureConnection | AzureConnectionProblem {
  const settings = settingsOf(value);
  if (settings === undefined) return 'not_a_connection_string';
  // A SAS cannot sign further URLs, and signing is what this string is for.
  if (settings.has('SharedAccessSignature')) return 'shared_access_signature_cannot_sign';
  // The shortcut means 127.0.0.1, which inside a container is the container itself.
  if (settings.has('UseDevelopmentStorage')) return 'development_shortcut_points_at_loopback';
  const accountName = settings.get('AccountName');
  if (accountName === undefined || !ACCOUNT_NAME.test(accountName)) return 'account_name_invalid';
  const accountKey = settings.get('AccountKey');
  if (accountKey === undefined || accountKey === '' || !BASE64.test(accountKey)) {
    return 'account_key_invalid';
  }
  const blobEndpoint = blobEndpointOf(settings, accountName);
  if (blobEndpoint === undefined) return 'blob_endpoint_invalid';
  return { accountName, accountKey, blobEndpoint };
}
