const { Markup } = require('telegraf');
const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { findChatByOrderId } = require('./order');

const ORDERS_PER_PAGE = 5;

function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['📚 Заказать работу'],
    ['🏴‍☠️ Морская Сокровищница'],
    ['👤 Профиль']
  ]).resize();
}

function register(bot) {
  // ==========================================
  // ГЛАВНОЕ МЕНЮ
  // ==========================================
  bot.command('start', async (ctx) => {
    ctx.session = ctx.session || {};
    const userName = ctx.from.first_name || 'Пользователь';
    
    await ctx.reply(
      `👋 *Добро пожаловать, ${userName}!*\n\n` +
      `Я — бот для заказа учебных работ.\n` +
      `Выберите раздел в меню 👇`,
      { 
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard() // 🌟 Распаковка — 100% работает
      }
    );
  });

  // 🌟 ОДНО СООБЩЕНИЕ: текст + inline-кнопки курсов
    bot.hears('📚 Заказать работу', async (ctx) => {
    const catalog = require('../data/catalog');
    const { createInlineKeyboard } = require('../utils/keyboard');
    
    const courseButtons = catalog.courses.map(c => [{ text: c.name, callback: `catalog:subject:${c.id}` }]);
    
    // 🌟 Только inline-кнопки курсов. Постоянная клавиатура останется в чате сама по себе.
    await ctx.reply(
      `📚 *Каталог работ*\n\nВыберите курс, чтобы начать:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(courseButtons).reply_markup
      }
    );
  });

  // 🌟 Сокровищница — с правильным синтаксисом клавиатуры
    bot.hears('🏴‍☠️ Морская Сокровищница', async (ctx) => {
    const treasureKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('1 курс ⭐️', 'treasure:1')],
      [Markup.button.callback('2 курс ⭐️⭐️', 'treasure:2')],
      [Markup.button.callback('3 курс ⭐️⭐️⭐️', 'treasure:3')],
      [Markup.button.callback('4 курс ⭐️⭐️⭐️⭐️', 'treasure:4')],
      [Markup.button.callback('Практика 🚢', 'treasure:prac')],
      [Markup.button.callback('🥂 Предложить работу 🥂', 'treasure:offer')]
    ]);
    
    // 🌟 Только inline-кнопки сокровищницы
    await ctx.reply(
      `💰 <b>Морская Сокровищница</b> 💰\n\nВыберите раздел, чтобы получить доступ к материалам:`,
      { 
        parse_mode: 'HTML', 
        reply_markup: treasureKeyboard.reply_markup
      }
    );
  });

  bot.hears('👤 Профиль', async (ctx) => {
    await showProfile(ctx);
  });

  // 🌟 НОВЫЙ: Обработчик кнопки "Назад в профиль"
  bot.action('profile:back', async (ctx) => {
    await showProfile(ctx);
    await ctx.answerCbQuery();
  });

  // ==========================================
  // ПРОФИЛЬ: ПРОГРАММА ЛОЯЛЬНОСТИ И АДМИНКА
  // ==========================================
  // 🌟 Программа лояльности с кнопкой "Назад"
  bot.action('profile:loyalty', async (ctx) => {
    const loyaltyDocLink = 'https://docs.google.com/document/d/1tcjS6BL9TVWVeH-cG7jj0lyYwJtyPViWj60lzhd3x-A/edit?usp=sharing';
    const msg = loyalty.getRanksDescription(loyaltyDocLink);
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]
    ]);
    
    // 🌟 Используем editMessageText, чтобы редактировать текущее сообщение
    await ctx.editMessageText(msg, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      ...keyboard
    });
    await ctx.answerCbQuery();
  });

  bot.action('profile:edit_works', async (ctx) => {
    const { showAdminMenu } = require('./admin');
    await showAdminMenu(ctx);
    await ctx.answerCbQuery();
  });

    // ==========================================
  // 📦 ВСЕ ЗАКАЗЫ (для админа с пагинацией)
  // ==========================================

  // 🌟 Главная страница "Все заказы"
  bot.action('profile:all_orders', async (ctx) => {
    const allOrders = ordersDb.getAllOrders();
    const totalPages = Math.max(1, Math.ceil(allOrders.length / ORDERS_PER_PAGE));
    
    const text = `📦 *Все заказы*\n\nСтраница 1 из ${totalPages}\nВсего: ${allOrders.length}`;
    
    const pageOrders = allOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = 'N/A'; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split('T')[0]; } } catch(e) { dateStr = 'N/A'; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    navRow.push(Markup.button.callback(`1/${totalPages}`, 'noop'));
    if (totalPages > 1) {
      navRow.push(Markup.button.callback('▶️', `orders:admin:list:all:1`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Пагинация для админа
  bot.action(/^orders:admin:list:(\w+):(\d+)$/, async (ctx) => {
    const filter = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    
    let allOrders = ordersDb.getAllOrders();
    let title = '📦 Все заказы';
    
    if (filter === 'pending') { allOrders = allOrders.filter(o => o.status === 'pending'); title = '⏳ Ожидают принятия'; }
    else if (filter === 'active') { allOrders = allOrders.filter(o => o.status === 'active'); title = '🔨 В работе'; }
    else if (filter === 'completed') { allOrders = allOrders.filter(o => o.status === 'completed'); title = '✅ Выполнены'; }
    
    const totalPages = Math.max(1, Math.ceil(allOrders.length / ORDERS_PER_PAGE));
    const currentPage = Math.min(page, totalPages - 1);
    
    const startIdx = currentPage * ORDERS_PER_PAGE;
    const pageOrders = allOrders.slice(startIdx, startIdx + ORDERS_PER_PAGE).reverse();
    
    let text = `${title}\n\n`;
    text += `Страница ${currentPage + 1} из ${totalPages}\n`;
    text += `Всего: ${allOrders.length}`;
    
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    if (currentPage > 0) {
      navRow.push(Markup.button.callback('◀️', `orders:admin:list:${filter}:${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
    if (currentPage < totalPages - 1) {
      navRow.push(Markup.button.callback('▶️', `orders:admin:list:${filter}:${currentPage + 1}`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Карточка заказа для админа (3 кнопки: Изменить, Написать, Назад)
  bot.action(/^orders:admin:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'admin');
    
    const buttons = [
      [Markup.button.callback('✏️ Изменить заказ', `orders:admin:edit:${orderId}`)],
      [Markup.button.callback('💬 Написать заказчику', `orders:admin:contact:${orderId}`)],
      [Markup.button.callback('⬅️ Назад', `orders:admin:back:all`)]
    ];
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Кнопка "Изменить заказ" — переход к редактированию полей
  bot.action(/^orders:admin:edit:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order) return;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📝 Название работы', `admin:order_field:${orderId}:workTitle`)],
      [Markup.button.callback('📖 Предмет', `admin:order_field:${orderId}:subjectName`)],
      [Markup.button.callback('🎓 Курс', `admin:order_field:${orderId}:courseName`)],
      [Markup.button.callback('💰 Цена', `admin:order_field:${orderId}:price`)],
      [Markup.button.callback('📊 Комиссия', `admin:order_field:${orderId}:commission`)],
      [Markup.button.callback('👤 Username заказчика', `admin:order_field:${orderId}:customerUsername`)],
      [Markup.button.callback('👷 Username исполнителя', `admin:order_field:${orderId}:executorUsername`)],
      [Markup.button.callback('⬅️ Назад к заказу', `orders:admin:view:${orderId}`)]
    ]);
    
    await ctx.editMessageText(
      `✏️ *Редактирование заказа*\n\nЗаказ: *${order.workTitle.substring(0, 30)}*\n\nВыберите поле:`,
      { parse_mode: 'Markdown', ...keyboard }
    );
    await ctx.answerCbQuery();
  });

  // 🌟 Кнопка "Написать заказчику" — включаем режим ответа
  bot.action(/^orders:admin:contact:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.adminReplyToCustomerId = order.customerId;
    ctx.session.adminReplyOrderId = orderId;
    ctx.session.adminReplyOrderTitle = order.workTitle;
    ctx.session.adminReplyOrderDate = order.createdAt;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отмена', `orders:admin:view:${orderId}`)]
    ]);
    
    await ctx.editMessageText(
      `💬 *Режим ответа заказчику*\n\n` +
      `📚 *Заказ:* ${order.workTitle}\n` +
      `📅 *Дата:* ${order.createdAt}\n\n` +
      `Напишите сообщение или прикрепите файл, которое будет отправлено заказчику.\n\n` +
      `_(Для отмены нажмите "Отмена")_`,
      { parse_mode: 'Markdown', ...keyboard }
    );
    await ctx.answerCbQuery();
  });

  // 🌟 Возврат к списку заказов админа
  bot.action(/^orders:admin:back:(\w+)$/, async (ctx) => {
    const allOrders = ordersDb.getAllOrders();
    const totalPages = Math.max(1, Math.ceil(allOrders.length / ORDERS_PER_PAGE));
    
    const text = `📦 *Все заказы*\n\nСтраница 1 из ${totalPages}\nВсего: ${allOrders.length}`;
    
    const pageOrders = allOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
    const navRow = [];
    navRow.push(Markup.button.callback(`1/${totalPages}`, 'noop'));
    if (totalPages > 1) {
      navRow.push(Markup.button.callback('▶️', `orders:admin:list:all:1`));
    }
    buttons.push(navRow);
    
    buttons.push([Markup.button.callback('⬅️ Назад в профиль', 'profile:back')]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Обновлённая карточка заказа для заказчика (с кнопкой "Написать исполнителю")
  bot.action(/^orders:customer:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order || String(order.customerId) !== String(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'customer');
    
    const buttons = [];
    
    // 🌟 Кнопка "Написать исполнителю" — если исполнитель назначен
    if (order.executorId) {
      buttons.push([Markup.button.callback('💬 Написать исполнителю', `orders:customer:contact:${orderId}`)]);
    }
    
    buttons.push([Markup.button.callback('⬅️ Назад', `orders:customer:back:${order.status}`)]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  // 🌟 Обновлённый обработчик "Написать исполнителю" для заказчика
bot.action(/^orders:customer:contact:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);

    if (!order || !order.executorId) {
        await ctx.answerCbQuery('❌ Исполнитель не назначен');
        return;
    }

    // 🌟 Пытаемся найти активный чат для этого заказа
    const { findChatByOrderId } = require('./order');
    const chatInfo = findChatByOrderId(orderId);
    
    // 🌟 Если чат не найден, создаём его структуру
    let chatId;
    if (chatInfo) {
        chatId = chatInfo.chatId;
    } else {
        // Формируем chatId как в accept_order
        chatId = `order_${ctx.from.id}_${order.workId}`;
    }

    ctx.session = ctx.session || {};
    ctx.session.customerReplyToExecutorId = order.executorId;
    ctx.session.customerReplyOrderId = orderId;
    ctx.session.customerReplyOrderTitle = order.workTitle;
    ctx.session.customerReplyOrderDate = order.createdAt;
    ctx.session.customerReplyOrderNumber = order.orderNumber || '—';
    ctx.session.customerReplyChatId = chatId; // 🌟 Сохраняем chatId

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', `orders:customer:view:${orderId}`)]
    ]);

    await ctx.editMessageText(
        `💬 *Режим ответа исполнителю*\n\n` +
        `📚 *Заказ:* ${order.workTitle}\n` +
        `📅 *Дата:* ${order.createdAt}\n\n` +
        `Напишите сообщение или прикрепите файл.\n\n` +
        `_(Для отмены нажмите "Отмена")_`,
        { parse_mode: 'Markdown', ...keyboard }
    );
    await ctx.answerCbQuery();
});

  // ==========================================
  // ИСТОРИЯ ЗАКАЗОВ ПОЛЬЗОВАТЕЛЯ (с пагинацией)
  // ==========================================
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
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
      )]);
    });
    
    if (pageOrders.length === 0) {
      buttons.push([Markup.button.callback('— пусто —', 'noop')]);
    }
    
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
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^orders:customer:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order || String(order.customerId) !== String(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'customer');
    
    const buttons = [];
    
    const chatInfo = findChatByOrderId(orderId);
    if (chatInfo && chatInfo.chatData.status !== 'closed') {
      buttons.push([Markup.button.callback('💬 Связаться с исполнителем', `orders:customer:contact:${orderId}`)]);
    } else if (order.executorUsername) {
      buttons.push([Markup.button.url('💬 Написать исполнителю', `https://t.me/${order.executorUsername}`)]);
    }
    
    buttons.push([Markup.button.callback('⬅️ Назад', `orders:customer:back:${order.status}`)]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^orders:customer:back:(\w+)$/, async (ctx) => {
    const status = ctx.match[1];
    const userOrders = ordersDb.getUserOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(userOrders.length / ORDERS_PER_PAGE));
    
    const statusTitles = {
      pending: '⏳ Ожидают принятия',
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\nСтраница 1 из ${totalPages}\nВсего: ${userOrders.length}`;
    
    const pageOrders = userOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
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
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

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
  bot.action('profile:my_orders', async (ctx) => {
    const executorOrders = ordersDb.getExecutorOrders(ctx.from.id);
    
    const active = executorOrders.filter(o => o.status === 'active').length;
    const completed = executorOrders.filter(o => o.status === 'completed').length;
    
    // Рассчитываем общий заработок (цена - комиссия) для выполненных заказов
    let totalEarnings = 0;
    executorOrders.forEach(order => {
      if (order.status === 'completed' && order.price && order.commission) {
        totalEarnings += (order.price - order.commission);
      }
    });
    
    const text = 
      `📋 *Мои заказы (Исполнитель)*\n\n` +
      `📦 *Всего принятых:* ${executorOrders.length}\n\n` +
      `🔨 *В работе:* ${active}\n` +
      `✅ *Выполнено:* ${completed}\n\n` +
      `💰 *Общий заработок:* ${totalEarnings} ₽`;
    
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
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
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
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^orders:executor:view:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    
    if (!order || String(order.executorId) !== String(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }
    
    const text = formatOrderCard(order, 'executor');
    
    const buttons = [];
    
    const chatInfo = findChatByOrderId(orderId);
    if (chatInfo && chatInfo.chatData.status !== 'closed') {
      buttons.push([Markup.button.callback('💬 Написать заказчику', `orders:executor:contact:${orderId}`)]);
    } else if (order.customerUsername) {
      buttons.push([Markup.button.url('💬 Написать заказчику', `https://t.me/${order.customerUsername}`)]);
    }
    
    buttons.push([Markup.button.callback('⬅️ Назад', `orders:executor:back:${order.status}`)]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^orders:executor:back:(\w+)$/, async (ctx) => {
    const status = ctx.match[1];
    const executorOrders = ordersDb.getExecutorOrders(ctx.from.id).filter(o => o.status === status);
    const totalPages = Math.max(1, Math.ceil(executorOrders.length / ORDERS_PER_PAGE));
    
    const statusTitles = {
      active: '🔨 В работе',
      completed: '✅ Выполнено'
    };
    
    let text = `${statusTitles[status]}\n\nСтраница 1 из ${totalPages}\nВсего: ${executorOrders.length}`;
    
    const pageOrders = executorOrders.slice(0, ORDERS_PER_PAGE).reverse();
    const buttons = [];
    
    pageOrders.forEach(order => {
      const title = order.workTitle.substring(0, 25);
      let dateStr = "N/A"; if (order.createdAt) { try { const d = new Date(order.createdAt); if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; } } catch(e) { dateStr = "N/A"; } };
      buttons.push([Markup.button.callback(
        `№${order.orderNumber} | ${title} | ${dateStr}`,
        `orders:customer:view:${order.id}`
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
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    await ctx.answerCbQuery();
  });

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

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
}

// ==========================================
// Вспомогательные функции
// ==========================================
function formatOrderCard(order, role) {
  let statusEmoji = '⏳';
  let statusText = 'Ожидает принятия';
  if (order.status === 'active') { statusEmoji = '🔨'; statusText = 'В работе'; }
  if (order.status === 'completed') { statusEmoji = '✅'; statusText = 'Выполнен'; }
  
  let text = `📦 *Заказ №${order.orderNumber}*\n\n`;
  text += `${statusEmoji} *Статус:* ${statusText}\n\n`;
  text += `📚 *Работа:* ${order.workTitle}\n`;
  text += `📖 *Предмет:* ${order.subjectName}\n`;
  text += `🎓 *Курс:* ${order.courseName}\n\n`;
  text += `💰 *Стоимость:* ${order.price} ₽\n`;
  
  if (role === 'executor' || role === 'admin') {
    text += `📊 *Комиссия:* ${order.commission}%\n\n`;
  } else {
    text += `\n`;
  }

  // Отображение ID заказчика и исполнителя для админа и исполнителя
  if (role === 'admin' || role === 'executor') {
    const customerDisplay = order.customerUsername 
      ? `${order.customerId} (@${order.customerUsername})`
      : `${order.customerId}`;
    text += `👤 *Заказчик:* ${customerDisplay}\n`;
    
    if (role === 'admin') {
      const executorDisplay = order.executorUsername 
        ? `${order.executorId} (@${order.executorUsername})`
        : (order.executorId ? `${order.executorId}` : '_не назначен_');
      text += `👷 *Исполнитель:* ${executorDisplay}\n\n`;
    } else if (role === 'executor' && order.executorId) {
      const executorDisplay = order.executorUsername 
        ? `${order.executorId} (@${order.executorUsername})`
        : `${order.executorId}`;
      text += `👷 *Вы (исполнитель):* ${executorDisplay}\n\n`;
    }
  }
  
  if (role === 'customer') {
    if (order.executorUsername) {
      text += `✅ *Исполнитель назначен*\n\n`;
    }
  }

  text += `📅 *Создан:* ${order.createdAt}\n`;
  if (order.acceptedAt) text += `🔨 *Принят:* ${order.acceptedAt}\n`;
  if (order.completedAt) text += `✅ *Выполнен:* ${order.completedAt}\n`;
  
  return text;
}

function currentRankIsMaxPublic(rank) {
  const publicRanks = loyalty.RANKS.filter(r => !r.secret);
  const lastPublicRank = publicRanks[publicRanks.length - 1];
  return rank.name === lastPublicRank.name;
}

// 🌟 Универсальная функция показа профиля (используется и в меню, и в кнопке "Назад")
async function showProfile(ctx) {
  ctx.session = ctx.session || {};
  const loyaltyInfo = loyalty.getLoyaltyInfo(ctx.from.id);
  const userName = ctx.from.first_name || 'Пользователь';
  
  let profileText = `👤 *Профиль пользователя*\n\n`;
  profileText += `*Имя:* ${userName}\n`;
  profileText += `*ID:* \`${ctx.from.id}\`\n\n`;
  profileText += `💵 *Программа лояльности*\n`;
  profileText += `${loyaltyInfo.rank.emoji} *${loyaltyInfo.rank.name}*\n`;
  profileText += `💰 *Сумма заказов:* ${loyaltyInfo.totalSpent} ₽\n`;
  profileText += `🎉 *Текущая скидка:* ${loyaltyInfo.discountPercent}%\n`;
  
  if (loyaltyInfo.progressToNext) {
    profileText += `➡️ *До следующего ранга (${loyaltyInfo.progressToNext.nextName}):* ${loyaltyInfo.progressToNext.need} ₽\n`;
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
    profileButtons.push([Markup.button.callback('🛠 Админ панель', 'profile:edit_works')]);
  }
  
  const profileKeyboard = Markup.inlineKeyboard(profileButtons);
  
  // 🌟 Если это callbackQuery — редактируем сообщение, иначе отправляем новое
  if (ctx.callbackQuery) {
    await ctx.editMessageText(profileText, { 
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard.reply_markup
    });
  } else {
    await ctx.reply(profileText, { 
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard.reply_markup
    });
  }
}

module.exports = { register, getMainMenuKeyboard, formatOrderCard };