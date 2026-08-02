const { Markup } = require('telegraf');

function createInlineKeyboard(buttons, backCallback = null) {
  const keyboard = buttons.map(row =>
    row.map(btn => Markup.button.callback(btn.text, btn.callback))
  );
  
  if (backCallback) {
    keyboard.push([Markup.button.callback('⬅️ Назад', backCallback)]);
  }
  
  return Markup.inlineKeyboard(keyboard);
}

module.exports = { createInlineKeyboard };