// Утилита для перевода Markdown → HTML в текстах, отправляемых в Telegram
// Используется однократно для рефакторинга order.js / menu.js / admin.js
const fs = require('fs');

// Защита от двойного экранирования: пропускаем уже экранированные последовательности
function escHtml(s) {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && '<>&'.includes(s[i + 1])) { r += c + s[i + 1]; i++; continue; }
    if (c === '&') { r += '&amp;'; continue; }
    if (c === '<') { r += '&lt;'; continue; }
    if (c === '>') { r += '&gt;'; continue; }
    r += c;
  }
  return r;
}

// Кандидатные границы для *...* и _..._ (символы, после которых закрытие НЕ считается маркером)
const NO_AFTER = new Set(('АаБбВвГгДдЕеЁёЖжЗзИиЙйКкЛлМмНнОоПпРрСсТтУуФфХхЦцЧчШшЩщЪъЫыЬьЭэЮюЯя' +
  'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz' +
  '0123456789' + '№—–…').split(''));

function convert(src) {
  // 🌟 Защита синтаксиса JS: гравикоты (шаблоны), переводы строк и \-экранирования
  const protectedStr = src
    .replace(/`/g, '@@BT@@')       // ` шаблона JS
    .replace(/\\\\/g, '@@BS@@')    // \\ — литеральный обратный слэш в исходнике
    .replace(/\\\n/g, '@@NL@@')    // \n — перевод строки внутри шаблона
    .replace(/\\`/g, '@@BQ@@');    // \` — Markdown code внутри текста сообщения

  src = protectedStr;

  // 1. `код` -> <code>код</code> (экранируем содержимое)
  src = src.replace(/(?<!\\)`([^`\n]+)`/g, (m, p1) => '<code>' + escHtml(p1) + '</code>');

  // 2. *жирный* -> <b>жирный</b>
  for (;;) {
    const idx = src.indexOf('*');
    if (idx === -1) break;
    let j = -1;
    for (let k = idx + 1; k < src.length; k++) {
      if (src[k] === '*' && src[k - 1] !== '\\') {
        const next = src[k + 1];
        if (next === undefined || !NO_AFTER.has(next)) { j = k; break; }
      }
    }
    if (j === -1) break;
    const inner = src.slice(idx + 1, j);
    if (!inner || inner.includes('<')) { // не парим внутри тегов/пустоту — помечаем и идём дальше
      src = src.slice(0, idx + 1) + '@@STAR@@' + src.slice(idx + 1);
      continue;
    }
    src = src.slice(0, idx) + '<b>' + escHtml(inner) + '</b>' + src.slice(j + 1);
  }
  src = src.replace(/@@STAR@@/g, '*');

  // 3. _курсив_ -> <i>курсив</i> (только пары без пробелов внутри — как в MarkdownV2)
  src = src.replace(/(?<!\\)_([^\s_][^_\n]*?)_/g, (m, p1) => '<i>' + escHtml(p1) + '</i>');

  // 4. Снимаем лишние Markdown-экранирования \X (кроме защищённых последовательностей)
  src = src.replace(/\\([_*[\]()~>#+\-=|{}.!])/g, '$1');

  // 5. Восстанавливаем защитки
  src = src
    .replace(/@@BQ@@/g, '\\`')     // \` — код в сообщении (HTML игнорирует _)
    .replace(/@@BT@@/g, '`')       // ` шаблона JS
    .replace(/@@BS@@/g, '\\\\')    // \\ литеральный обратный слэш
    .replace(/@@NL@@/g, '\\n');    // \n перевод строки

  return src;
}

module.exports = { convert };

if (require.main === module) {
  const file = process.argv[2];
  const codeStart = parseInt(process.argv[3], 10);
  const codeEnd = parseInt(process.argv[4], 10);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = codeStart - 1; i < codeEnd; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*(?:text|caption|summary|profileText|supportText|message|title)\s*(?:\+?=)\s*)`(.*)`;?(\s*)$/);
    if (!m) continue;
    const converted = convert(m[2]);
    if (converted !== m[2]) {
      lines[i] = m[1] + '`' + converted + '`;' + m[3];
    }
  }
  fs.writeFileSync(file, lines.join('\n'));
  console.log('OK:', file, 'lines', codeStart + '-' + codeEnd);
}
