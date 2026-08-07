const { Markup } = require('telegraf');
const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { findChatByOrderId } = require('./order');

const ORDERS_PER_PAGE = 5; // Количество заказов на одной странице

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

  bot.action('profile:history', async (ctx) => {
    const userOrders = ordersDb.getUserOrders(ctx.from.id);
    
    const pending = userOrders.filter(o => o.status === 'pending').length;
    const active = userOrders.filter(o => o.status === 'active').length;
    const completed = userOrders.filter(o => o.status === 'completed').length;
    
    const text = 
      `📜 *История заказов*\n\n` +
      `📦 *Всего заказов:* ${userOrders.length}\n\n` +
      `⏳ *Ожидают принятия:* ${pending}\n` +
      `🔨 *В работе:* ${active}\n` +
      `✅ *Выполнено:* ${completed}`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`⏳ Ожидают (${pending})`, 'orders:customer:list:pending:0')],
      [Markup.button.callback(`🔨 В работе (${active})`, 'orders:customer:list:active:0')],
      [Markup.button.callback(`✅ Выполнено (${completed})`, 'orders:customer:list:completed:0')],
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Список заказов с пагинацией (для заказчика)
  bot.action(/^orders:customer:list:(\w+):(\d+)$/, async (ctx) => {
    const status = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    
    const userOrders = ordersDb.getUserOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(userOrders.length / ORDERS_PER_PAGE));
    const currentPage = Math.min(page, totalPages - 1);
    
    const startIdx = currentPage * ORDERS_PER_PAGE;
    const pageOrders = userOrders.slice(startIdx, startIdx + ORDERS_PER_PAGE).reverse();
    
    const statusTitles = {
      pending: '⏳ Ожидают принятия',
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\n`;
    text += `Страница ${currentPage + 1} из ${totalPages}\n`;
    text += `Всего: ${userOrders.length}`;
    
    const buttons = [];
    
    // Кнопки заказов
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 30);
      const date = order.createdAt.split(' ')[0]; // Только дата без времени
      buttons.push([Markup.button.callback(
        `📝 ${title} | 📅 ${date}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    // Навигация
    const navRow = [];
    if (currentPage > 0) {
      navRow.push(Markup.button.callback('◀️', `orders:customer:list:${status}:${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
    if (currentPage < totalPages - 1) {
      navRow.push(Markup.button.callback('▶️', `orders:customer:list:${status}:${currentPage + 1}`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад к истории', 'profile:history')]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Карточка заказа для заказчика
  bot.action(/^orders:customer:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order || String(order.customerId) !== String(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'customer');
    
    const buttons = [];
    
    // Кнопка связи с исполнителем
    const chatInfo = findChatByOrderId(orderId);
    if (chatInfo && chatInfo.chatData.status !== 'closed') {
      buttons.push([Markup.button.callback('💬 Связаться с исполнителем', `orders:customer:contact:${orderId}`)]);
    } else if (order.executorUsername) {
      // Если чат закрыт, но есть username — показываем ссылку
      buttons.push([Markup.button.url('💬 Написать исполнителю', `https://t.me/${order.executorUsername}`)]);
    }
    
    buttons.push([Markup.button.callback('⬅️ Назад', `orders:customer:back:${order.status}`)]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Возврат к списку заказов заказчика (сохраняем статус)
  bot.action(/^orders:customer:back:(\w+)$/, async (ctx) => {
    const status = ctx.match[1];
    await ctx.editMessageText('⏳ Загрузка...');
    // Триггерим обработчик списка
    ctx.match = [null, status, '0'];
    await ctx.answerCbQuery();
    // Вызываем логику списка напрямую
    const userOrders = ordersDb.getUserOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(userOrders.length / ORDERS_PER_PAGE));
    
    const statusTitles = {
      pending: '⏳ Ожидают принятия',
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\n`;
    text += `Страница 1 из ${totalPages}\n`;
    text += `Всего: ${userOrders.length}`;
    
    const pageOrders = userOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 30);
      const date = order.createdAt.split(' ')[0];
      buttons.push([Markup.button.callback(
        `📝 ${title} | 📅 ${date}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    navRow.push(Markup.button.callback(`1/${totalPages}`, 'noop'));
    if (totalPages > 1) {
      navRow.push(Markup.button.callback('▶️', `orders:customer:list:${status}:1`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад к истории', 'profile:history')]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  });

  // 🌟 Связаться с исполнителем (открыть чат)
  bot.action(/^orders:customer:contact:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const chatInfo = findChatByOrderId(orderId);
    
    if (!chatInfo || chatInfo.chatData.status === 'closed') {
      await ctx.answerCbQuery('❌ Чат по этому заказу завершён');
      return;
    }
    
    const chatId = chatInfo.chatId;
    const chatData = chatInfo.chatData;
    
    const text = 
      `💬 *Чат с исполнителем*\n\n` +
      `📚 *Заказ:* ${chatData.workTitle}\n\n` +
      `Выберите действие:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Написать исполнителю', `customer_reply:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл/фото', `customer_send_file:${chatId}`)],
      [Markup.button.callback('❌ Завершить чат', `customer_close_chat:${chatId}`)],
      [Markup.button.callback('⬅️ Назад к заказу', `orders:customer:view:${orderId}`)]
    ]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // ==========================================
  // МОИ ЗАКАЗЫ ИСПОЛНИТЕЛЯ (с пагинацией)
  // ==========================================

  // 🌟 Главная страница "Мои заказы" для исполнителя
  bot.action('profile:my_orders', async (ctx) => {
    const executorOrders = ordersDb.getExecutorOrders(ctx.from.id);
    
    const active = executorOrders.filter(o => o.status === 'active').length;
    const completed = executorOrders.filter(o => o.status === 'completed').length;
    
    const text = 
      `📋 *Мои заказы (Исполнитель)*\n\n` +
      `📦 *Всего принятых:* ${executorOrders.length}\n\n` +
      `🔨 *В работе:* ${active}\n` +
      `✅ *Выполнено:* ${completed}`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`🔨 Активные (${active})`, 'orders:executor:list:active:0')],
      [Markup.button.callback(`✅ Выполненные (${completed})`, 'orders:executor:list:completed:0')],
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Список заказов исполнителя с пагинацией
  bot.action(/^orders:executor:list:(\w+):(\d+)$/, async (ctx) => {
    const status = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    
    const executorOrders = ordersDb.getExecutorOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(executorOrders.length / ORDERS_PER_PAGE));
    const currentPage = Math.min(page, totalPages - 1);
    
    const startIdx = currentPage * ORDERS_PER_PAGE;
    const pageOrders = executorOrders.slice(startIdx, startIdx + ORDERS_PER_PAGE).reverse();
    
    const statusTitles = {
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\n`;
    text += `Страница ${currentPage + 1} из ${totalPages}\n`;
    text += `Всего: ${executorOrders.length}`;
    
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 30);
      const date = order.createdAt.split(' ')[0];
      buttons.push([Markup.button.callback(
        `📝 ${title} | 📅 ${date}`,
        `orders:executor:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    if (currentPage > 0) {
      navRow.push(Markup.button.callback('◀️', `orders:executor:list:${status}:${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
    if (currentPage < totalPages - 1) {
      navRow.push(Markup.button.callback('▶️', `orders:executor:list:${status}:${currentPage + 1}`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад', 'profile:my_orders')]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Карточка заказа для исполнителя
  bot.action(/^orders:executor:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order || String(order.executorId) !== String(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'executor');
    
    const buttons = [];
    
    // Кнопка связи с заказчиком
    const chatInfo = findChatByOrderId(orderId);
    if (chatInfo && chatInfo.chatData.status !== 'closed') {
      buttons.push([Markup.button.callback('💬 Написать заказчику', `orders:executor:contact:${orderId}`)]);
    } else if (order.customerUsername) {
      buttons.push([Markup.button.url('💬 Написать заказчику', `https://t.me/${order.customerUsername}`)]);
    }
    
    buttons.push([Markup.button.callback('⬅️ Назад', `orders:executor:back:${order.status}`)]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Возврат к списку заказов исполнителя
  bot.action(/^orders:executor:back:(\w+)$/, async (ctx) => {
    const status = ctx.match[1];
    const executorOrders = ordersDb.getExecutorOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(executorOrders.length / ORDERS_PER_PAGE));
    
    const statusTitles = {
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\n`;
    text += `Страница 1 из ${totalPages}\n`;
    text += `Всего: ${executorOrders.length}`;
    
    const pageOrders = executorOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 30);
      const date = order.createdAt.split(' ')[0];
      buttons.push([Markup.button.callback(
        `📝 ${title} | 📅 ${date}`,
        `orders:executor:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    navRow.push(Markup.button.callback(`1/${totalPages}`, 'noop'));
    if (totalPages > 1) {
      navRow.push(Markup.button.callback('▶️', `orders:executor:list:${status}:1`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад', 'profile:my_orders')]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Связаться с заказчиком (открыть чат)
  bot.action(/^orders:executor:contact:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const chatInfo = findChatByOrderId(orderId);
    
    if (!chatInfo || chatInfo.chatData.status === 'closed') {
      await ctx.answerCbQuery('❌ Чат по этому заказу завершён');
      return;
    }
    
    const chatId = chatInfo.chatId;
    const chatData = chatInfo.chatData;
    
    const text = 
      `💬 *Чат с заказчиком*\n\n` +
      `📚 *Заказ:* ${chatData.workTitle}\n\n` +
      `Выберите действие:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить заказчику', `executor_reply:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл/фото', `executor_send_file:${chatId}`)],
      [Markup.button.callback('❌ Завершить чат', `executor_close_chat:${chatId}`)],
      [Markup.button.callback('⬅️ Назад к заказу', `orders:executor:view:${orderId}`)]
    ]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  // Пустое действие для кнопок-заглушек
  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
}

// ==========================================
// Вспомогательная функция: карточка заказа
// ==========================================
function formatOrderCard(order, role) {
  let statusEmoji = '⏳';
  let statusText = 'Ожидает принятия';
  if (order.status === 'active') { statusEmoji = '🔨'; statusText = 'В работе'; }
  if (order.status === 'completed') { statusEmoji = '✅'; statusText = 'Выполнен'; }
  
  let text = `📦 *Заказ #${order.id.substr(-6)}*\n\n`;
  text += `${statusEmoji} *Статус:* ${statusText}\n\n`;
  text += `📚 *Работа:* ${order.workTitle}\n`;
  text += `📖 *Предмет:* ${order.subjectName}\n`;
  text += `🎓 *Курс:* ${order.courseName}\n\n`;
  text += `💰 *Стоимость:* ${order.price} ₽\n`;

  // Комиссия показываем только для исполнителя и админа
  if (role === 'executor' || role === 'admin') {
    text += `📊 *Комиссия:* ${order.commission}%\n\n`;
  } else {
    text += `\n`;
  }
  
  // Для заказчика НЕ показываем исполнителя (только если он уже назначен — в виде статуса)
  if (role === 'customer') {
    if (order.executorUsername) {
      text += `✅ *Исполнитель назначен*\n\n`;
    }
  }
  
  // Для исполнителя и админа показываем участников
  if (role === 'executor') {
    const customer = order.customerUsername ? `@${order.customerUsername}` : `ID: ${order.customerId}`;
    text += `👤 *Заказчик:* ${customer}\n\n`;
  }

  if (role === 'admin') {
    const customer = order.customerUsername ? `@${order.customerUsername}` : `ID: ${order.customerId}`;
    const executor = order.executorUsername 
      ? `@${order.executorUsername}` 
      : (order.executorId ? `ID: ${order.executorId}` : '_не назначен_');
    text += `👤 *Заказчик:* ${customer}\n`;
    text += `👷 *Исполнитель:* ${executor}\n\n`;
  }
  
  text += `📅 *Создан:* ${order.createdAt}\n`;
  if (order.acceptedAt) text += `🔨 *Принят:* ${order.acceptedAt}\n`;
  if (order.completedAt) text += `✅ *Выполнен:* ${order.completedAt}\n`;
  
  return text;
}

// 🌟 Функция проверки максимального публичного ранга
function currentRankIsMaxPublic(rank) {
  const loyalty = require('../data/loyalty');
  const publicRanks = loyalty.RANKS.filter(r => !r.secret);
  const lastPublicRank = publicRanks[publicRanks.length - 1];
  return rank.name === lastPublicRank.name;
}

module.exports = { register, getMainMenuKeyboard, formatOrderCard };