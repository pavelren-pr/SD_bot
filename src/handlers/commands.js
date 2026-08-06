const { getMainMenuKeyboard } = require('./menu');

function register(bot) {
  // 🌟 ЕДИНСТВЕННАЯ точка входа для /start теперь здесь
  bot.command('start', async (ctx) => {
    ctx.session = ctx.session || {};
    const userLink = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    await ctx.reply(
      `👋 *Добро пожаловать, ${userLink}!*\n\n` +
      `Я — бот для заказа учебных работ.\n` +
      `Выберите раздел в меню ниже:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard() // 🌟 Постоянная клавиатура
      }
    );
  });

  // Если у тебя были другие команды (например, /help), оставь их ниже:
  // bot.command('help', async (ctx) => { ... });
}

module.exports = { register };