import { getContainerRuntimeClient } from 'testcontainers';
import { inject } from 'vitest';

/** The header of a frame in Docker's multiplexed log stream: stream type, 3 zero bytes, length. */
const FRAME_HEADER_BYTES = 8;

/**
 * Joins the payloads of Docker's multiplexed log frames: a container without a TTY sends stdout
 * and stderr as frames of an 8-byte header (stream type 0 to 2, three zero bytes, payload length
 * as a big-endian uint32) and the payload.
 */
export function demultiplexDockerLog(frames: Buffer): string {
  const payloads: Buffer[] = [];
  let offset = 0;
  while (offset + FRAME_HEADER_BYTES <= frames.length) {
    const length = frames.readUInt32BE(offset + 4);
    const start = offset + FRAME_HEADER_BYTES;
    payloads.push(frames.subarray(start, start + length));
    offset = start + length;
  }
  return Buffer.concat(payloads).toString('utf8');
}

/**
 * The test cluster's server log so far (02 §8, 06 §3): its own log settings of ADR 0005 §4.10
 * plus log_statement=all, so it holds every statement and every error line of the run. The
 * server writes its log to the container's output, which Docker keeps.
 */
export async function readServerLog(): Promise<string> {
  const { containerId } = inject('integrationCluster');
  const client = await getContainerRuntimeClient();
  const frames = await client.container
    .getById(containerId)
    .logs({ follow: false, stdout: true, stderr: true });
  return demultiplexDockerLog(frames);
}
