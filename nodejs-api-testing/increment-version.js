const fs = require('fs');
const path = require('path');

const versionFile = path.join(__dirname, 'version.json');
const version = require('./version.json');

// Increment build number
version.build += 1;

// Write back to file
fs.writeFileSync(versionFile, JSON.stringify(version, null, 4));

// Output the new version
console.log(`v${version.major}.${version.minor}.${version.build}`); 