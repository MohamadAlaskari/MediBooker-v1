// Fixture for library.json: typed exports that the preset turns into declaration files.
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
