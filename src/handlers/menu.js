const { Markup } = require('telegraf');
const loyalty = require('../data/loyalty');
const catalog = require('../data/catalog');
const { createInlineKeyboard } = require('../utils/keyboard');

function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['📚 Заказать работу'],
    ['🏴‍☠️ Морская Сокровищница'],
    ['👤 Профиль']
  ]).resize();
}

function register(bot) {
  // 🌟 1. Обработчик /start
  bot.command('start', async (ctx) => {
    ctx.session = ctx.session || {};
    const userName = ctx.from.first_name || 'Пользователь';
    
    await ctx.reply(
      `👋 *Добро пожаловать, ${userName}!*\n\n` +
      `Я — бот для заказа учебных работ.\n` +
      `Выберите раздел в меню 👇`,
      { 
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard()
      }
    );
  });

  // 🌟 2. Заказать работу (с инициализацией сессии)
  bot.hears('📚 Заказать работу', async (ctx) => {
    ctx.session = ctx.session || {}; // 🌟 ВАЖНО: инициализация сессии
    ctx.session.menuState = 'catalog';
    
    const courseButtons = catalog.courses.map(c => [{ text: c.name, callback: `catalog:subject:${c.id}` }]);
    
    await ctx.reply(
      '📚 *Каталог работ*\n\nВыберите курс, чтобы начать:',
      {
        parse_mode: 'Markdown',
        ...createInlineKeyboard(courseButtons)
      }
    );
  });

  // 🌟 3. Морская Сокровищница (с инициализацией сессии)
  bot.hears('🏴‍☠️ Морская Сокровищница', async (ctx) => {
    ctx.session = ctx.session || {}; // 🌟 ВАЖНО: инициализация сессии
    
    const treasureKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('1 курс ⭐️', 'treasure:1')],
      [Markup.button.callback('2 курс ⭐️⭐️', 'treasure:2')],
      [Markup.button.callback('3 курс ⭐️⭐️⭐️', 'treasure:3')],
      [Markup.button.callback('4 курс ⭐️⭐️⭐️⭐️', 'treasure:4')],
      [Markup.button.callback('Практика 🚢', 'treasure:prac')],
      [Markup.button.callback('🥂 Предложить работу 🥂', 'treasure:offer')]
    ]);

    await ctx.reply(
      `💰 <b>Морская Сокровищница</b> 💰\n\nВыберите раздел, чтобы получить доступ к материалам:`,
      { 
        parse_mode: 'HTML', 
        ...treasureKeyboard
      }
    );
  });

  // 🌟 4. Профиль (с инициализацией сессии)
  bot.hears('👤 Профиль', async (ctx) => {
    ctx.session = ctx.session || {}; // 🌟 ВАЖНО: инициализация сессии
    
    const loyaltyInfo = loyalty.getLoyaltyInfo(ctx.from.id);
    const userName = ctx.from.first_name || 'Пользователь';
    
    let profileText = ` *Профиль пользователя*\n\n`;
    profileText += `*Имя:* ${userName}\n`;
    profileText += `*ID:* \`${ctx.from.id}\`\n\n`;
    profileText += `💵 *Программа лояльности*\n`;
    profileText += `${loyaltyInfo.rank.emoji} *${loyaltyInfo.rank.name}*\n`;
    profileText += `💰 *Сумма заказов:* ${loyaltyInfo.totalSpent} ₽\n`;
    profileText += ` *Текущая скидка:* ${loyaltyInfo.discountPercent}%\n`;
    
    if (loyaltyInfo.progressToNext) {
      profileText += `➡️ *До следующего ранга (${loyaltyInfo.progressToNext.nextName}):* ${loyaltyInfo.progressToNext.need} ₽\n`;
    } else if (currentRankIsMaxPublic(loyaltyInfo.rank)) {
      profileText += `👑 *Вы достигли максимального ранга!*\n`;
    }
    
    profileText += `\nВыберите раздел:`;
    
    const profileButtons = [
      [Markup.button.callback(' История заказов', 'profile:history')],
      [Markup.button.callback('💵 Программа лояльности', 'profile:loyalty')]
    ];
    
    if (loyaltyInfo.hasExecutorAccess || loyaltyInfo.hasFullAccess) {
      profileButtons.push([Markup.button.callback('📋 Мои заказы (Исполнитель)', 'profile:my_orders')]);
    }
    
    if (loyaltyInfo.hasFullAccess) {
      profileButtons.push([Markup.button.callback('🛠 Изменить информацию о работах', 'profile:edit_works')]);
      profileButtons.push([Markup.button.callback('📝 Изменить заказы (Админ)', 'profile:edit_orders')]);
    }
    
    const profileKeyboard = Markup.inlineKeyboard(profileButtons);

    await ctx.reply(profileText, { 
      parse_mode: 'Markdown',
      ...profileKeyboard
    });
  });

  // --- Обработчики inline-кнопок профиля (редактируют одно сообщение) ---
  
  // 🌟 Программа лояльности
  bot.action('profile:loyalty', async (ctx) => {
    const loyaltyDocLink = 'https://docs.google.com/document/d/1tcjS6BL9TVWVeH-cG7jj0lyYwJtyPViWj60lzhd3x-A/edit?usp=sharing';
    const msg = loyalty.getRanksDescription(loyaltyDocLink);
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('️ Назад в профиль', 'profile:back')]
    ]);
    
    // 🌟 Используем editMessageText вместо reply
    await ctx.editMessageText(msg, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 История заказов
  bot.action('profile:history', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    await ctx.editMessageText('📜 *История заказов*\n\nЭтот раздел находится в разработке. Скоро здесь появится список всех ваших заказов!', { 
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Мои заказы
  bot.action('profile:my_orders', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    await ctx.editMessageText('📋 *Мои заказы (Исполнитель)*\n\nЭтот раздел находится в разработке.', { 
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Изменить работы
    bot.action('profile:edit_works', async (ctx) => {
    const { showAdminMenu } = require('./admin');
    await showAdminMenu(ctx);
    await ctx.answerCbQuery();
  });

  //  Изменить заказы
  bot.action('profile:edit_orders', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    await ctx.editMessageText('📝 *Управление заказами*\n\nЭтот раздел находится в разработке.', { 
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Кнопка "Назад в профиль" (возвращает к исходному виду профиля)
  bot.action('profile:back', async (ctx) => {
    const loyaltyInfo = loyalty.getLoyaltyInfo(ctx.from.id);
    const userName = ctx.from.first_name || 'Пользователь';
    
    let profileText = ` *Профиль пользователя*\n\n`;
    profileText += `*Имя:* ${userName}\n`;
    profileText += `*ID:* \`${ctx.from.id}\`\n\n`;
    profileText += `💵 *Программа лояльности*\n`;
    profileText += `${loyaltyInfo.rank.emoji} *${loyaltyInfo.rank.name}*\n`;
    profileText += `💰 *Сумма заказов:* ${loyaltyInfo.totalSpent} ₽\n`;
    profileText += `🎉 *Текущая скидка:* ${loyaltyInfo.discountPercent}%\n`;
    
    if (loyaltyInfo.progressToNext) {
      profileText += `️ *До следующего ранга (${loyaltyInfo.progressToNext.nextName}):* ${loyaltyInfo.progressToNext.need} ₽\n`;
    } else if (currentRankIsMaxPublic(loyaltyInfo.rank)) {
      profileText += `👑 *Вы достигли максимального ранга!*\n`;
    }
    
    profileText += `\nВыберите раздел:`;
    
    const profileButtons = [
      [Markup.button.callback('📜 История заказов', 'profile:history')],
      [Markup.button.callback('💵 Программа лояльности', 'profile:loyalty')]
    ];
    
    if (loyaltyInfo.hasExecutorAccess || loyaltyInfo.hasFullAccess) {
      profileButtons.push([Markup.button.callback('📋 Мои заказы (Исполнитель)', 'profile:my_orders')]);
    }
    
    if (loyaltyInfo.hasFullAccess) {
      profileButtons.push([Markup.button.callback('🛠 Изменить информацию о работах', 'profile:edit_works')]);
      profileButtons.push([Markup.button.callback(' Изменить заказы (Админ)', 'profile:edit_orders')]);
    }
    
    const profileKeyboard = Markup.inlineKeyboard(profileButtons);

    //  Просто редактируем сообщение обратно в профиль
    await ctx.editMessageText(profileText, { 
      parse_mode: 'Markdown',
      ...profileKeyboard
    });
    
    await ctx.answerCbQuery();
  });
}

// 🌟 Функция проверки максимального публичного ранга
function currentRankIsMaxPublic(rank) {
  const loyalty = require('../data/loyalty');
  const publicRanks = loyalty.RANKS.filter(r => !r.secret);
  const lastPublicRank = publicRanks[publicRanks.length - 1];
  return rank.name === lastPublicRank.name;
}

module.exports = { register, getMainMenuKeyboard };