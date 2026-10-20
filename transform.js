const fs = require('fs');
const file = 'c:/Users/bob/Desktop/teste/index.html';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('--theme-color:')) {
  code = code.replace('<style>', '<style>\n  :root {\n    --theme-color: #8a2be2;\n  }\n');
}

code = code.replace(/#8a2be2/g, 'var(--theme-color)');

code = code.replace(/rgba\(138,\s*43,\s*226,\s*([0-9.]+)\)/g, (match, p1) => {
  let percentage = parseFloat(p1) * 100;
  return 'color-mix(in srgb, var(--theme-color) ' + percentage + '%, transparent)';
});

if (!code.includes("setProperty('--theme-color'")) {
  code = code.replace(/(id:\s*'particlesColor'[^]*?onChange:\s*\(cor\)\s*=>\s*\{[^]*?localStorage\.setItem\('particlesColor',\s*cor\);)/, 
    '$1\n        document.documentElement.style.setProperty("--theme-color", cor);');
}

if (!code.includes('Init Theme Color')) {
  code = code.replace(/(<script>\s*)/, '$1\n  // Init Theme Color\n  document.documentElement.style.setProperty("--theme-color", localStorage.getItem("particlesColor") || "#8a2be2");\n');
}

fs.writeFileSync(file, code, 'utf8');
console.log('Success!');
