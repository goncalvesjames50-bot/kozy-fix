const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.win = pkg.build.win || {};
pkg.build.win.requestedExecutionLevel = "requireAdministrator";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json updated for requireAdministrator!');
