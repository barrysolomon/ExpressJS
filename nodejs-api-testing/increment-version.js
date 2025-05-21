import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionFile = path.join(__dirname, 'version.json');
const version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));

// Increment build number
version.build += 1;

// Write back to file
fs.writeFileSync(versionFile, JSON.stringify(version, null, 4));

// Output the new version
console.log(`v${version.major}.${version.minor}.${version.build}`); 