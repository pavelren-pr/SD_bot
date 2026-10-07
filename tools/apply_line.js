// Применяет convert() к строке файла по номеру линии (без изменений синтаксиса JS-шаблонов)
const fs = require('fs');
const { convert } = require('./refactor_md2html');
const file = process.argv[2];
const lineNo = parseInt(process.argv[3], 10);
const lines = fs.readFileSync(file, 'utf8').split('\n');
const idx = lineNo - 1;
const converted = convert(lines[idx]);
if (converted !== lines[idx]) {
  lines[idx] = converted;
  fs.writeFileSync(file, lines.join('\n'));
  console.log('CHANGED line', lineNo);
} else {
  console.log('NO CHANGE line', lineNo);
}
