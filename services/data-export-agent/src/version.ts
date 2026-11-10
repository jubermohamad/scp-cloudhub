import fs from 'fs';
import path from 'path';

/**
 * The agent version from package.json. Read at runtime (not imported) so the
 * same code works from src/ under jest and from dist/ in the image, where
 * package.json sits one directory up in both cases.
 */
export function agentVersion(): string {
  try {
    // This package is not bundled, so __dirname is reliable here.
    // eslint-disable-next-line no-restricted-syntax
    const file = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
