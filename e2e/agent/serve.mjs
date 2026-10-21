import { baseUrl, createFixtureServer } from './server.mjs';

const server = createFixtureServer();
let interrupted = false;
async function stop() {
  interrupted = true;
  try { await server.stop(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await server.start();
  if (!interrupted) console.log(`Agent fixture ready: ${baseUrl}\nClose your WDIO session, then stop this process with Ctrl-C.`);
} catch (error) {
  if (!interrupted) { console.error(error); process.exitCode = 1; }
}
