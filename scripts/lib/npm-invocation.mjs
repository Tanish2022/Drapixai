import fs from 'node:fs';
import path from 'node:path';

// Run npm's JS entry point with the exact Node that runs the verifier. A Windows
// npm.cmd can otherwise prefer its adjacent, older node.exe over our PATH.
export function npmInvocation(args, { env = process.env, execPath = process.execPath } = {}) {
  const explicit = env.DRAPIXAI_NPM_CLI || env.npm_execpath;
  const usable = (candidate) => {
    if (!path.isAbsolute(candidate) || path.basename(candidate) !== 'npm-cli.js') return null;
    try {
      const real = fs.realpathSync(candidate);
      return fs.statSync(real).isFile() ? real : null;
    } catch { return null; }
  };
  if (explicit) {
    const cli = usable(explicit);
    if (!cli) throw new Error('NPM_CLI_PATH_INVALID');
    return { command: execPath, args: [cli, ...args] };
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const directories = [path.dirname(execPath), ...(env[pathKey] || '').split(path.delimiter).filter(Boolean)];
  for (const directory of directories) {
    for (const candidate of [path.join(directory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js')]) {
      const cli = usable(candidate);
      if (cli) return { command: execPath, args: [cli, ...args] };
    }
  }
  throw new Error('NPM_CLI_UNAVAILABLE: set DRAPIXAI_NPM_CLI to the installed npm-cli.js');
}
