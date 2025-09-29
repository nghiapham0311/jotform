// scripts/obfuscate-light.js
const fs = require('fs-extra');
const path = require('path');
const obfuscator = require('javascript-obfuscator');

const projectRoot = path.resolve(__dirname, '..');
// chỉ obfuscate 2 file như bạn yêu cầu
const files = ['content.js', 'background.js'].map(f => path.join(projectRoot, f));
const backupDir = path.join(projectRoot, 'backup_obf_light');

fs.ensureDirSync(backupDir);

// LIGHT options: gần như giữ nguyên logic, không đổi global, không encode string, không self-defend
const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  selfDefending: false,
  disableConsoleOutput: false,

  // ổn định hơn với stacktrace; nếu muốn ngắn hơn có thể để 'hexadecimal'
  identifierNamesGenerator: 'mangled',

  renameGlobals: false,
  stringArray: false,
  transformObjectKeys: false,

  // tránh tối ưu hóa làm đổi side-effects/timing
  simplify: false,

  // để test: có map lần ra lỗi; build release thì tắt 2 dòng này
  sourceMap: true,
  sourceMapMode: 'separate',

  seed: 2025,

  // GIỮ NGUYÊN các tên này (rất quan trọng)
  reservedNames: [
    // browser & core
    '^window$', '^self$', '^globalThis$', '^document$', '^console$', '^location$',
    '^Event$', '^CustomEvent$', '^InputEvent$', '^MouseEvent$', '^PointerEvent$',
    '^requestAnimationFrame$', '^setTimeout$', '^clearTimeout$', '^CSS$',

    // extension
    '^chrome$', '^browser$',

    // bundler
    '^__webpack_require__$',

    // cờ/contract của bạn
    '^__JF_PARENT_BRIDGE__$', '^__JF_IFRAME_READY__$',

    // nếu có nơi khác gọi tên hàm theo string, giữ luôn:
    '^mainLoop$', '^shouldTickCard$', '^selectWidgetOptionsInCard$'
  ],
};

(async () => {
  for (const filePath of files) {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn('Skip (not found):', filePath);
        continue;
      }

      const base = path.basename(filePath);
      const bak = path.join(backupDir, base + '.orig');

      // backup original only once (preserve original)
      if (!fs.existsSync(bak)) {
        fs.copyFileSync(filePath, bak);
        console.log('Backed up', base, '->', bak);
      } else {
        console.log('Backup exists for', base);
      }

      const code = fs.readFileSync(filePath, 'utf8');

      // Obfuscate lightly
      let obf;
      try {
        obf = obfuscator.obfuscate(code, options).getObfuscatedCode();
      } catch (e) {
        console.error('Obfuscation failed for', base, e);
        // if obfuscation fails, do not overwrite file
        continue;
      }

      fs.writeFileSync(filePath, obf, 'utf8');
      console.log('Obfuscated (light) =>', base);
    } catch (err) {
      console.error('Error processing', filePath, err);
    }
  }
  console.log('Light obfuscation done. Originals in', backupDir);
})();
