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
  compact: true,                        // remove whitespace
  controlFlowFlattening: false,         // KHÔNG flatten → giữ ổn định
  deadCodeInjection: false,
  debugProtection: false,
  selfDefending: false,
  disableConsoleOutput: false,          // giữ console
  identifierNamesGenerator: 'hexadecimal', // ngắn gọn, rối mắt
  renameGlobals: false,                 // KHÔNG đổi tên global (chrome, window, self,...)
  stringArray: false,                   // KHÔNG mã hóa chuỗi (giữ tương tác message safe)
  transformObjectKeys: false,
  seed: 2025,                           // cố định kết quả giữa các lần build
  // giữ các tên global quan trọng để không bị đổi
  reservedNames: [
    '^chrome$', '^browser$', '^window$', '^self$', '^globalThis$', '^document$', '^console$',
    '^__webpack_require__$'
  ],
  // Kích thước output lớn/nhỏ do compact + mangling
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
