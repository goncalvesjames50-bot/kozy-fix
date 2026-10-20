const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.win = pkg.build.win || {};
pkg.build.win.icon = "build/icon.png";

pkg.build.nsis = pkg.build.nsis || {};
pkg.build.nsis.installerIcon = "build/icon.png";
pkg.build.nsis.uninstallerIcon = "build/icon.png";
pkg.build.nsis.installerHeaderIcon = "build/icon.png";
pkg.build.nsis.installerSidebar = "build/installerSidebar.png";
pkg.build.nsis.uninstallerSidebar = "build/installerSidebar.png";
pkg.build.nsis.installerHeader = "build/installerHeader.png";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json updated with banners and icons!');
