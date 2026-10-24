import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError } from './security.js';
export async function validateCvStructure(bytes: Uint8Array, type: string) {
  const ts = import.meta.url.endsWith('.ts');
  await new Promise<void>((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./cv-file-worker.' + (ts ? 'ts' : 'js'), import.meta.url)), [], { execArgv: ['--max-old-space-size=128', ...(ts ? ['--import', import.meta.resolve('tsx')] : [])], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    // The validator is isolated with a strict memory limit. Allow enough time for
    // its Node/tsx process to start on a busy Windows host or CI worker, while
    // still failing closed instead of keeping an untrusted document process alive.
    const timer = setTimeout(() => finish(false), 30000);
    let result: boolean | undefined;
    const finish = (valid: boolean) => { if (result !== undefined) return; result = valid; clearTimeout(timer); child.kill(); };
    child.once('error', () => finish(false));
    // A kill request does not mean the process has exited. On Windows its cwd
    // stays locked until close; do not release callers while the worker is alive.
    child.once('close', () => {
      clearTimeout(timer);
      if (result === true) resolve();
      else reject(new ApiError(415, 'CV_MALFORMED', 'The CV is malformed, encrypted, unsafe or exceeds document limits.'));
    });
    child.once('message', message => finish(typeof message === 'object' && message !== null && 'valid' in message && message.valid === true));
    child.send({ bytes: Buffer.from(bytes).toString('base64'), type }, error => { if (error) finish(false); });
  });
}
