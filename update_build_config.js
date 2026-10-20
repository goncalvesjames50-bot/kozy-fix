const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.npmRebuild = false;

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json updated: npmRebuild set to false!');
