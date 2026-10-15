import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
for (const name of ['entry', 'provider-entry']) {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: [`${name}.mjs`],
    platform: 'browser',
    format: 'esm',
    bundle: true,
    metafile: true,
    write: false,
    outfile: `${name}-bundle.mjs`,
  });
  const output = Object.values(result.metafile.outputs)[0];
  console.log(JSON.stringify({
    name,
    bytes: output.bytes,
    inputFiles: Object.keys(result.metafile.inputs).length,
    externalImports: output.imports,
  }));
}
