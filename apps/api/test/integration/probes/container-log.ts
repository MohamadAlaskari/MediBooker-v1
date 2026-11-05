import { getContainerRuntimeClient } from 'testcontainers';
import { demultiplexDockerLog } from '../support/server-log.js';

/**
 * The output of a container a spec started itself (the TLS spec's cluster), which is that
 * server's log: readServerLog() reads only the shared cluster's.
 */
export async function readContainerLog(containerId: string): Promise<string> {
  const client = await getContainerRuntimeClient();
  const frames = await client.container
    .getById(containerId)
    .logs({ follow: false, stdout: true, stderr: true });
  return demultiplexDockerLog(frames);
}
