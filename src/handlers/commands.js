const { createInlineKeyboard } = require('../utils/keyboard');

function register(bot) {
  bot.start((ctx) => {
    // 🛡️ Гарантируем наличие объекта сессии перед её использованием
    ctx.session = ctx.session || {};
    ctx.session.order = null; // Сброс сессии при старте
    
    const keyboard = createInlineKeyboard([
      [{ text: '📚 Открыть каталог работ', callback: 'catalog:courses' }]
    ]);
    
    ctx.reply('Привет! Я умный помощник Smart Deals. Чем могу помочь?', keyboard);
  });

  bot.command('cancel', (ctx) => {
    // 🛡️ Гарантируем наличие объекта сессии
    ctx.session = ctx.session || {};
    ctx.session.order = null;
    
    const keyboard = createInlineKeyboard([
      [{ text: '📚 Открыть каталог', callback: 'catalog:courses' }]
    ]);
    
    ctx.reply('❌ Заказ отменён. Возвращаемся в главное меню:', keyboard);
  });
}

module.exports = { register };