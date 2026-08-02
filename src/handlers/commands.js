const { createInlineKeyboard } = require('../utils/keyboard');
const catalog = require('../data/catalog');

function register(bot) {
  bot.start((ctx) => {
    ctx.session.order = null; // Сброс сессии при старте
    const keyboard = createInlineKeyboard([
      [{ text: '📚 Открыть каталог работ', callback: 'catalog:courses' }]
    ]);
    ctx.reply('Привет! Я умный помощник Smart Deals. Чем могу помочь?', keyboard);
  });

  bot.command('cancel', (ctx) => {
    ctx.session.order = null;
    ctx.reply('❌ Заказ отменён. Главное меню:', Markup.inlineKeyboard([
      [Markup.button.callback('📚 Открыть каталог', 'catalog:courses')]
    ]));
  });
}

module.exports = { register };