import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
const timers = new Set();
let stopping = false;
function launch(name, args) {
  if (stopping) return;
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', ...args], { cwd, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.on('error', () => console.error(`${name} could not start.`));
  child.on('exit', () => {
    children.delete(child);
    if (stopping) return;
    console.error(`${name} stopped; restarting in 15 seconds.`);
    const timer = setTimeout(() => { timers.delete(timer); launch(name, args); }, 15000);
    timers.add(timer);
  });
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const dev = process.argv.includes('--dev');
launch('API', dev ? ['--import', 'tsx', '--watch', 'src/index.ts'] : ['dist/index.js']);
launch('Job discovery worker', dev ? ['--import', 'tsx', 'src/job-engine/cli.ts', 'watch'] : ['dist/job-engine/cli.js', 'watch']);
launch('Semantic indexing worker', dev ? ['--import', 'tsx', 'src/job-engine/cli.ts', 'watch-semantic'] : ['dist/job-engine/cli.js', 'watch-semantic']);
