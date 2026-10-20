const koffi = require('koffi');

const magnification = koffi.load('Magnification.dll');

const MagInitialize = magnification.func('bool MagInitialize()');
const MagUninitialize = magnification.func('bool MagUninitialize()');
const MagSetFullscreenColorEffect = magnification.func(
  'bool MagSetFullscreenColorEffect(float *effect)'
);

let initialized = false;

function ensureInit() {
  if (!initialized) {
    initialized = MagInitialize();
  }
}

// Gera matriz 5x5 de saturação preservando luminância
function saturationMatrix(s) {
  const lr = 0.213, lg = 0.715, lb = 0.072;
  const a = (1 - s) * lr, b = (1 - s) * lg, c = (1 - s) * lb;

  // matriz 5x5, row-major, ultima linha/coluna = identidade
  return [
    a + s, a,     a,     0, 0,
    b,     b + s, b,     0, 0,
    c,     c,     c + s, 0, 0,
    0,     0,     0,     1, 0,
    0,     0,     0,     0, 1,
  ];
}

function setSaturation(s) {
  ensureInit();
  MagSetFullscreenColorEffect(saturationMatrix(s));
}

function reset() {
  setSaturation(1); // 1 = normal
}

function cleanup() {
  if (initialized) {
    MagUninitialize();
    initialized = false;
  }
}

module.exports = { setSaturation, reset, cleanup };
