/**
 * Certificates of the TLS spec, generated at run time with @peculiar/x509 (02 §12): a CA, and a
 * server certificate it signs for the host the tests reach the container under. Nothing is
 * committed; the private keys exist only in memory and in the test's temporary directory.
 */
import { webcrypto } from 'node:crypto';
import { isIP } from 'node:net';
import {
  AuthorityKeyIdentifierExtension,
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  PemConverter,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509CertificateGenerator,
  type X509Certificate,
} from '@peculiar/x509';

const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNING_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' };

/** A fixed validity window, so no certificate depends on the time the test runs. */
const NOT_BEFORE = new Date('2020-01-01T00:00:00Z');
const NOT_AFTER = new Date('2049-12-31T23:59:59Z');

export interface CertificateAuthority {
  /** The CA certificate in PEM: what a client trusts (`ca_secret_ref`, `sslrootcert`). */
  readonly pem: string;
  readonly certificate: X509Certificate;
  readonly keys: webcrypto.CryptoKeyPair;
}

export interface ServerCertificate {
  readonly certificatePem: string;
  /** PKCS #8 in PEM. */
  readonly privateKeyPem: string;
}

function generateKeys(): Promise<webcrypto.CryptoKeyPair> {
  return webcrypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify']);
}

export async function createCertificateAuthority(name: string): Promise<CertificateAuthority> {
  const keys = await generateKeys();
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      name: `CN=${name}`,
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
      keys,
      signingAlgorithm: SIGNING_ALGORITHM,
      extensions: [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
        await SubjectKeyIdentifierExtension.create(keys.publicKey, false, webcrypto),
      ],
    },
    webcrypto,
  );
  return { pem: certificate.toString('pem'), certificate, keys };
}

/**
 * A server certificate for `host`: a DNS name, or an IP address as an IP entry, because a client
 * checks an IP address against the certificate's IP entries (02 §5 item 3).
 */
export async function createServerCertificate(
  authority: CertificateAuthority,
  host: string,
): Promise<ServerCertificate> {
  const keys = await generateKeys();
  const certificate = await X509CertificateGenerator.create(
    {
      subject: `CN=${host}`,
      issuer: authority.certificate.subject,
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
      publicKey: keys.publicKey,
      signingKey: authority.keys.privateKey,
      signingAlgorithm: SIGNING_ALGORITHM,
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
        new SubjectAlternativeNameExtension([
          { type: isIP(host) === 0 ? 'dns' : 'ip', value: host },
        ]),
        await AuthorityKeyIdentifierExtension.create(authority.keys.publicKey, false, webcrypto),
      ],
    },
    webcrypto,
  );
  const privateKey = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    certificatePem: certificate.toString('pem'),
    privateKeyPem: PemConverter.encode(privateKey, 'PRIVATE KEY'),
  };
}
