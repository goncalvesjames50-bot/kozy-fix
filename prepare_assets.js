const { Jimp } = require('jimp');
const fs = require('fs');

if (!fs.existsSync('build')) {
    fs.mkdirSync('build');
}

async function prepareAssets() {
    try {
        const logo = await Jimp.read('logo_pf.jpg');
        
        // 1. App Icon (icon.png - 256x256)
        const icon = logo.clone().resize({ w: 256, h: 256 });
        await icon.write('build/icon.png');
        console.log('Created build/icon.png');

        // 2. Installer Sidebar (164 x 314)
        const sidebar = new Jimp({ width: 164, height: 314, color: '#100e17' });
        const logoForSidebar = logo.clone().resize({ w: 120, h: 120 });
        sidebar.composite(logoForSidebar, (164 - 120) / 2, (314 - 120) / 2);
        await sidebar.write('build/installerSidebar.png');
        console.log('Created build/installerSidebar.png');

        // 3. Installer Header (150 x 57)
        const header = new Jimp({ width: 150, height: 57, color: '#100e17' });
        const logoForHeader = logo.clone().resize({ w: 40, h: 40 });
        header.composite(logoForHeader, 150 - 50, (57 - 40) / 2);
        await header.write('build/installerHeader.png');
        console.log('Created build/installerHeader.png');

    } catch (e) {
        console.error(e);
    }
}

prepareAssets();
