const fs = require('fs');
const file = 'c:/Users/bob/Desktop/teste/index.html';
let code = fs.readFileSync(file, 'utf8');

const badRegex = /<div class="mouse-card" onclick="selectGalleryMouse\(this, 'delux\.png', 'DELUX'\)">[\s\S]*?<div id="tab-teclado" class="tab-pane" style="display: none;">/;

const goodBlock = `<div class="mouse-card" onclick="selectGalleryMouse(this, 'delux.png', 'DELUX')">
            <div class="mouse-img-container"><img src="delux.png" alt="Delux"></div>
            <div class="mouse-card-title">DELUX</div>
          </div>
          <div class="mouse-card" onclick="selectGalleryMouse(this, 'dragonfly r1.png', 'DRAGONFLY R1')">
            <div class="mouse-img-container"><img src="dragonfly r1.png" alt="Dragonfly R1"></div>
            <div class="mouse-card-title">DRAGONFLY R1</div>
          </div>
          <div class="mouse-card" onclick="selectGalleryMouse(this, 'fallen pantera eco.png', 'FALLEN PANTERA ECO')">
            <div class="mouse-img-container"><img src="fallen pantera eco.png" alt="Fallen Pantera Eco"></div>
            <div class="mouse-card-title">FALLEN PANTERA ECO</div>
          </div>
          <div class="mouse-card" onclick="selectGalleryMouse(this, 'g pro superlight .png', 'G PRO SUPERLIGHT')">
            <div class="mouse-img-container"><img src="g pro superlight .png" alt="G Pro Superlight"></div>
            <div class="mouse-card-title">G PRO SUPERLIGHT</div>
          </div>
          <div class="mouse-card" onclick="selectGalleryMouse(this, 'mousenovo.png', 'MOUSE NOVO')">
            <div class="mouse-img-container"><img src="mousenovo.png" alt="Mouse Novo"></div>
            <div class="mouse-card-title">MOUSE NOVO</div>
          </div>
          <div class="mouse-card" onclick="selectGalleryMouse(this, 'Attack shark x11.png', 'ATTACK SHARK X11')">
            <div class="mouse-img-container"><img src="Attack shark x11.png" alt="Attack Shark X11"></div>
            <div class="mouse-card-title">ATTACK SHARK X11</div>
          </div>
        </div>
      </div>
      </div>

      <div id="tab-teclado" class="tab-pane" style="display: none;">`;

if (code.match(badRegex)) {
  code = code.replace(badRegex, goodBlock);
  fs.writeFileSync(file, code, 'utf8');
  console.log('Fixed layout and added new mice!');
} else {
  console.log('Could not find the damaged layout.');
}
