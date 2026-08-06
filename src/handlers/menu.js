const { Markup } = require('telegraf');
const loyalty = require('../data/loyalty');

function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['📚 Заказать работу'],
    ['🏴‍☠️ Морская Сокровищница'],
    ['👤 Профиль']
  ]).resize();
}

function register(bot) {
  bot.command('start', async (ctx) => {
    ctx.session = ctx.session || {};
    const userLink = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    await ctx.reply(
      `👋 *Добро пожаловать, ${userLink}!*\n\n` +
      `Я — бот для заказа учебных работ.\n` +
      `Выберите раздел в меню ниже:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      }
    );
  });

  bot.hears('📚 Заказать работу', async (ctx) => {
    // Здесь будет логика перехода к каталогу (через inline кнопки)
    await ctx.reply('📚 *Каталог работ*\n\nВыберите курс, чтобы начать:', { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
    // Примечание: полноценный переход к каталогу реализуется через inline-кнопки в catalog.js
  });

  bot.hears('🏴‍☠️ Морская Сокровищница', async (ctx) => {
    // Передаем управление в treasure.js
    ctx.session.menuState = 'treasure';
    await ctx.reply('💰 *Загрузка Морской Сокровищницы...* 💰', { reply_markup: getMainMenuKeyboard() });
    // Триггерим действие сокровищницы
    await ctx.telegram.sendCopy(ctx.chat.id, { text: 'dummy' }); // Хак для триггера, лучше просто вызвать функцию напрямую
    // Правильный способ:
    const { register: registerTreasure } = require('./treasure');
    // Мы просто отправим сообщение, которое обработает treasure, или вызовем его логику:
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('1 курс ⭐️', 'treasure:1')],
      [Markup.button.callback('2 курс ⭐️⭐️', 'treasure:2')],
      [Markup.button.callback('3 курс ⭐️⭐️⭐️', 'treasure:3')],
      [Markup.button.callback('4 курс ⭐️⭐️⭐️⭐️', 'treasure:4')],
      [Markup.button.callback('Практика 🚢', 'treasure:prac')],
      [Markup.button.callback('🥂 Предложить работу 🥂', 'treasure:offer')]
    ]);
    await ctx.reply(`💰 <b>Морская Сокровищница</b> 💰\n\nВыберите раздел, чтобы получить доступ к материалам:`, { 
      parse_mode: 'HTML', 
      reply_markup: keyboard 
    });
  });

  bot.hears('👤 Профиль', async (ctx) => {
    ctx.session = ctx.session || {};
    const loyaltyInfo = loyalty.getLoyaltyInfo(ctx.from.id);
    const userName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    let profileText = `👤 *Профиль пользователя*\n\n`;
    profileText += `*Имя:* ${userName}\n`;
    profileText += `*ID:* \`${ctx.from.id}\`\n\n`;
    profileText += `💵 *Программа лояльности*\n`;
    profileText += `${loyaltyInfo.rank.emoji} *${loyaltyInfo.rank.name}*\n`;
    profileText += `💰 *Сумма заказов:* ${loyaltyInfo.totalSpent} ₽\n`;
    profileText += `🎉 *Текущая скидка:* ${loyaltyInfo.discountPercent}%\n`;
    
    if (loyaltyInfo.progressToNext) {
      profileText += `➡️ *До следующего ранга:* ${loyaltyInfo.progressToNext.need} ₽\n`;
    } else if (!loyaltyInfo.rank.secret) {
      profileText += `👑 *Вы достигли максимального публичного ранга!*\n`;
    }
    
    profileText += `\nВыберите раздел:`;
    
    const profileButtons = [
      [{ text: '📜 История заказов', callback: 'profile:history' }],
      [{ text: '💵 Программа лояльности', callback: 'profile:loyalty' }]
    ];
    
    if (loyaltyInfo.hasExecutorAccess || loyaltyInfo.hasFullAccess) {
      profileButtons.push([{ text: '📋 Мои заказы (Исполнитель)', callback: 'profile:my_orders' }]);
    }
    
    if (loyaltyInfo.hasFullAccess) {
      profileButtons.push([{ text: '🛠 Изменить информацию о работах', callback: 'profile:edit_works' }]);
      profileButtons.push([{ text: '📝 Изменить заказы (Админ)', callback: 'profile:edit_orders' }]);
    }
    
    await ctx.reply(profileText, { 
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(profileButtons)
    });
  });

  // Обработчик кнопки "Программа лояльности" из профиля
  bot.action('profile:loyalty', async (ctx) => {
    const loyaltyDocLink = 'https://docs.google.com/document/d/1tcjS6BL9TVWVeH-cG7jj0lyYwJtyPViWj60lzhd3x-A/edit?usp=sharing';
    const msg = loyalty.getRanksDescription(loyaltyDocLink);
    await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
    await ctx.answerCbQuery();
  });

  // Заглушки для будущих разделов
  bot.action('profile:history', async (ctx) => {
    await ctx.reply('📜 *История заказов*\n\nЭтот раздел находится в разработке. Скоро здесь появится список всех ваших заказов!', { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('profile:my_orders', async (ctx) => {
    await ctx.reply('📋 *Мои заказы (Исполнитель)*\n\nЭтот раздел находится в разработке.', { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('profile:edit_works', async (ctx) => {
    await ctx.reply('🛠 *Режим редактирования работ*\n\nОтправьте секретный пароль администратора в этот чат, чтобы открыть панель управления.', { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('profile:edit_orders', async (ctx) => {
    await ctx.reply('📝 *Управление заказами*\n\nЭтот раздел находится в разработке.', { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });
}

module.exports = { register, getMainMenuKeyboard };