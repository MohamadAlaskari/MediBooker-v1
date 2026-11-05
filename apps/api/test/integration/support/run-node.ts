import { spawn } from 'node:child_process';

/** The exit code and the captured output of a Node child process. */
export interface NodeRun {
  /** null when the process could not start or was killed. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `node <args>` with the given environment and captures its output. The specs run the
 * Prisma CLI and medibooker-db this way, as `process.execPath <entry>`: a `.cmd` shim cannot be
 * spawned without a shell, and a shell breaks on the spaces of the repository path.
 */
export function runNode(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env: NodeJS.ProcessEnv },
): Promise<NodeRun> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', () => {
      resolve({ exitCode: null, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}
