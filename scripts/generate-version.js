#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const packagePath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const versionContent = `// Auto-generated version file - do not edit manually
export const APP_VERSION = '${pkg.version}';
`;

const outputPath = path.join(rootDir, 'src', 'version.ts');
fs.writeFileSync(outputPath, versionContent, 'utf8');

console.log(`Generated version file: ${outputPath}`);
console.log(`  Version: ${pkg.version}`);
