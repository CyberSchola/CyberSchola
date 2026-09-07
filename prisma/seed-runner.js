// Small JS bootstrap that registers ts-node with CommonJS compiler option
// This avoids quoting problems in npm scripts on Windows shells.
require('ts-node').register({
  transpileOnly: true,
  // Override a couple of TS options so the runtime compilation works in Node
  // and avoids TS errors related to bundler moduleResolution used by Next.
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

// Load the TypeScript seed file (ts-node will compile it on the fly)
require('./seed.ts');
