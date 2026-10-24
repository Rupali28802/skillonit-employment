/**
 * Release gate: resolve the built Express app without binding a port.
 * This catches missing named exports caused by an incomplete dist deployment.
 */
try {
  await import('../dist/app.js');
  console.info('Built API module contract: PASS');
} catch (error) {
  console.error('Built API module contract: FAIL');
  process.exitCode = 1;
}