const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { formatOrderCard } = require('./menu');
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const { assignExecutorToOrder, unassignExecutorFromOrder, buildGroupOrderText } = require('./order');

const PENDING_STATUSES = ['pending', 'waiting_acceptance', 'waiting_price', 'price_negotiating'];
const ACTIVE_STATUSES = ['active', 'paid'];
const COMPLETED_STATUSES = ['completed'];
const ORDERS_PER_PAGE = 5;

// ==========================================
// Проверка прав (только Циклоп)
// ==========================================
function isManager(userId) {
  const info = loyalty.getLoyaltyInfo(userId);
  return info.hasManagerAccess;
}

// Получить заказы конкретного отдела (по переменной чата)
function getDepartmentOrders(chatEnv) {
  const chatId = process.env[chatEnv];
  if (!chatId) return [];
  const allOrders = ordersDb.getAllOrders().filter(o => !o._meta);
  return allOrders.filter(o => String(o.managerChatId) === String(chatId));
}

// Получить имя отдела по переменной чата
function getDepartmentName(userId, chatEnv) {
  const chats = loyalty.getManagedChats(userId);
  const found = chats.find(c => c.chatEnv === chatEnv);
  return found ? found.name : chatEnv;
}

// ==========================================
// Отображение списка заказов отдела
// ==========================================
async function showDepartmentOrders(ctx, chatEnv, deptIdx, filter, page) {
  const deptName = getDepartmentName(ctx.from.id, chatEnv);
  const allDeptOrders = getDepartmentOrders(chatEnv);

  let filtered = allDeptOrders;
  let title = '📋 Все заказы отдела';
  if (filter === 'pending') { filtered = allDeptOrders.filter(o => PENDING_STATUSES.includes(o.status)); title = '⏳ Ожидают принятия'; }
  else if (filter === 'active') { filtered = allDeptOrders.filter(o => ACTIVE_STATUSES.includes(o.status)); title = '🔨 В работе'; }
  else if (filter === 'completed') { filtered = allDeptOrders.filter(o => COMPLETED_STATUSES.includes(o.status)); title = '✅ Выполнены'; }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ORDERS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const displayOrders = filtered.slice(currentPage * ORDERS_PER_PAGE, (currentPage + 1) * ORDERS_PER_PAGE).reverse();

  let text = `🏢 *Отдел:* ${deptName}\n`;
  text += `${title}\n\n`;
  text += `Страница ${currentPage + 1} из ${totalPages}\n`;
  text += `Всего заказов: ${filtered.length}`;

  const buttons = displayOrders.map(o => {
    let dateStr = 'N/A';
    if (o.createdAt) {
      try {
        const d = new Date(o.createdAt);
        if (!isNaN(d.getTime())) dateStr = d.toISOString().split('T')[0];
      } catch(e) { dateStr = 'N/A'; }
    }
    const workTitle = o.workTitle || 'Без названия';
    const orderNum = o.orderNumber || 'N/A';
    const typeEmoji = o.isCustomOrder ? '🌟' : '📦';
    return [Markup.button.callback(
      `${typeEmoji} №${orderNum} | ${workTitle.substring(0, 15)} | ${dateStr}`,
      `dept:view:${o.id}`
    )];
  });
  if (buttons.length === 0) buttons.push([Markup.button.callback('— пусто —', 'noop')]);

  // Навигация
  const navRow = [];
  if (currentPage > 0) navRow.push(Markup.button.callback('◀️', `dept:list:${deptIdx}:${filter}:${currentPage - 1}`));
  navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
  if (currentPage < totalPages - 1) navRow.push(Markup.button.callback('▶️', `dept:list:${deptIdx}:${filter}:${currentPage + 1}`));
  buttons.push(navRow);

  // Фильтры
  const p = allDeptOrders.filter(o => PENDING_STATUSES.includes(o.status)).length;
  const a = allDeptOrders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
  const c = allDeptOrders.filter(o => COMPLETED_STATUSES.includes(o.status)).length;

  buttons.push([Markup.button.callback(`⏳ Ожидают (${p})`, `dept:list:${deptIdx}:pending:0`)]);
  buttons.push([Markup.button.callback(`🔨 В работе (${a})`, `dept:list:${deptIdx}:active:0`)]);
  buttons.push([Markup.button.callback(`✅ Выполнены (${c})`, `dept:list:${deptIdx}:completed:0`)]);
  buttons.push([Markup.button.callback(`📋 Все заказы (${allDeptOrders.length})`, `dept:list:${deptIdx}:all:0`)]);

  const chats = loyalty.getManagedChats(ctx.from.id);
  if (chats.length > 1) {
    buttons.push([Markup.button.callback('🏢 Выбрать другой отдел', 'dept:main')]);
  }
  buttons.push([Markup.button.callback('🔙 Назад в профиль', 'profile:back')]);

    // 🌟 Оборачиваем в try-catch, чтобы не падать при повторном нажатии той же кнопки
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (e) {
    // Игнорируем ошибку "сообщение не изменено" — она возникает при нажатии на уже активный раздел
    if (!e.message || !e.message.includes('message is not modified')) {
      console.error('Ошибка обновления списка заказов отдела:', e.message);
    }
  }
}

// ==========================================
// Карточка заказа для управляющего
// ==========================================
async function showOrderCard(ctx, orderId) {
  const order = ordersDb.getOrder(orderId);
  if (!order) {
    await ctx.answerCbQuery('❌ Заказ не найден');
    return;
  }
  ctx.session = ctx.session || {};
  ctx.session.deptState = null;

  const text = formatOrderCard(order, 'admin');
  const buttons = [];

  // Написать заказчику
  buttons.push([Markup.button.callback('💬 Написать заказчику', `dept:msg:${orderId}`)]);

  // 🌟 Кнопка привязки к отделу (если у заказа нет чата)
  if (!order.managerChatId) {
    buttons.push([Markup.button.callback('🏢 Привязать к отделу', `dept:bind_chat:${orderId}`)]);
  }

  // Кнопки статусов (аналогично админ-панели, но БЕЗ редактирования и удаления)
  if (order.isCustomOrder) {
    if (order.status !== 'completed') {
      buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `dept:assign:${orderId}`)]);
    }
    buttons.push([Markup.button.callback('🔄 Сменить статус', `dept:status_menu:${orderId}`)]);
  } else {
    if (order.status === 'pending') {
      if (!order.executorId) {
        buttons.push([Markup.button.callback('🔨 Назначить исполнителя', `dept:assign:${orderId}`)]);
      } else {
        buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `dept:assign:${orderId}`)]);
      }
      buttons.push([Markup.button.callback('✅ Отметить выполненным', `dept:status:${orderId}:completed`)]);
    } else if (order.status === 'active') {
      buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `dept:assign:${orderId}`)]);
      buttons.push([Markup.button.callback('✅ Отметить выполненным', `dept:status:${orderId}:completed`)]);
      buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `dept:status:${orderId}:pending`)]);
    } else {
      buttons.push([Markup.button.callback('🔨 Вернуть в работу', `dept:status:${orderId}:active`)]);
      buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `dept:status:${orderId}:pending`)]);
    }
  }

  if (order.customerUsername) {
    buttons.push([Markup.button.url('🔗 Профиль заказчика', `https://t.me/${order.customerUsername}`)]);
  }
  buttons.push([Markup.button.callback('⬅️ Назад к списку', 'dept:main')]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

// ==========================================
// Регистрация обработчиков
// ==========================================
function register(bot) {

  // --- ГЛАВНОЕ МЕНЮ ОТДЕЛА ---
  bot.action('dept:main', async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }

    const chats = loyalty.getManagedChats(ctx.from.id);
    if (chats.length === 0) {
      await ctx.editMessageText(
        '🏢 *Заказы моего отдела*\n\n⚠️ Вам не назначены чаты отделов.\nОбратитесь к администратору.',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад в профиль', 'profile:back')]]) }
      );
      return;
    }

    if (chats.length === 1) {
      await showDepartmentOrders(ctx, chats[0].chatEnv, 0, 'all', 0);
      return;
    }

    let text = '🏢 *Заказы моего отдела*\n\nВыберите отдел:';
    const buttons = chats.map((c, idx) => {
      const ordersCount = getDepartmentOrders(c.chatEnv).length;
      return [Markup.button.callback(`🏢 ${c.name} (${ordersCount})`, `dept:list:${idx}:all:0`)];
    });
    buttons.push([Markup.button.callback('🔙 Назад в профиль', 'profile:back')]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^dept:list:(\d+):(.+):(\d+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const deptIdx = parseInt(ctx.match[1]);
    const filter = ctx.match[2];
    const page = parseInt(ctx.match[3]) || 0;
    const chats = loyalty.getManagedChats(ctx.from.id);
    if (!chats[deptIdx]) {
      await ctx.answerCbQuery('❌ Отдел не найден');
      return;
    }
    await showDepartmentOrders(ctx, chats[deptIdx].chatEnv, deptIdx, filter, page);
    await ctx.answerCbQuery(); // 🌟 Добавляем, чтобы закрыть "часики"
  });

  // --- КАРТОЧКА ЗАКАЗА ---
  bot.action(/^dept:view:(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    await showOrderCard(ctx, ctx.match[1]);
  });

  // --- СМЕНА СТАТУСА ---
  bot.action(/^dept:status:(.+):(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const newStatus = ctx.match[2];
    const order = ordersDb.getOrder(orderId);
    if (!order) {
      await ctx.answerCbQuery('❌ Заказ не найден');
      return;
    }

    // Если возвращаем в ожидание — снимаем исполнителя
    if (newStatus === 'pending' && order.status === 'active' && order.executorId) {
      await unassignExecutorFromOrder(orderId, bot);
    } else {
      const updates = { status: newStatus };
      if (newStatus === 'active' && !order.acceptedAt) updates.acceptedAt = new Date().toLocaleString('ru-RU');
      if (newStatus === 'completed' && !order.completedAt) updates.completedAt = new Date().toLocaleString('ru-RU');
      ordersDb.updateOrder(orderId, updates);

      logger.logAdminAction('dept_order_status_change', {
        orderId: orderId,
        orderNumber: order.orderNumber,
        oldStatus: order.status,
        newStatus: newStatus,
        managerId: ctx.from.id
      }, ctx);

      // Обновляем сообщение в группе отдела
      const updatedOrderForGroup = ordersDb.getOrder(orderId);
      if (updatedOrderForGroup && updatedOrderForGroup.managerMessageId && updatedOrderForGroup.managerChatId) {
        let statusForText;
        if (newStatus === 'completed') statusForText = 'completed';
        else if (newStatus === 'active' || newStatus === 'paid') statusForText = 'in_progress';
        else statusForText = 'new';
        const updatedGroupText = buildGroupOrderText(updatedOrderForGroup, statusForText);
        try {
          await ctx.telegram.editMessageText(
            updatedOrderForGroup.managerChatId,
            updatedOrderForGroup.managerMessageId,
            null,
            updatedGroupText,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          console.log('Не удалось обновить сообщение в группе:', e.message);
        }
      }
    }

    await ctx.answerCbQuery('✅ Статус изменён');
    await showOrderCard(ctx, orderId);
  });

  // --- МЕНЮ СТАТУСОВ ДЛЯ КАСТОМНЫХ ЗАКАЗОВ ---
  bot.action(/^dept:status_menu:(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order) return;

    const statusKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🟡 Ожидает принятия', `dept:status:${orderId}:waiting_acceptance`)],
      [Markup.button.callback('🟠 Ожидает цену', `dept:status:${orderId}:waiting_price`)],
      [Markup.button.callback('🔵 Согласование цены', `dept:status:${orderId}:price_negotiating`)],
      [Markup.button.callback('🟢 Оплачен', `dept:status:${orderId}:paid`)],
      [Markup.button.callback('✅ Выполнен', `dept:status:${orderId}:completed`)],
      [Markup.button.callback('⬅️ Назад', `dept:view:${orderId}`)]
    ]);
    await ctx.editMessageText(
      `🔄 *Смена статуса заказа №${order.orderNumber}*\n\nТекущий статус: *${order.status}*`,
      { parse_mode: 'Markdown', ...statusKeyboard }
    );
  });

  // --- НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ: запрос ID ---
  bot.action(/^dept:assign:(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

    // Список исполнителей, админов и управляющих
    const loyaltyData = loyalty.loadData();
    let availableUsersText = '';
    const executors = [];
    const admins = [];
    const managers = [];
    for (const [userId, userData] of Object.entries(loyaltyData)) {
      if (userData.rank === 'Прометей') {
        executors.push({ id: userId, username: userData.username || null });
      } else if (userData.rank === 'Посейдон') {
        admins.push({ id: userId, username: userData.username || null });
      } else if (userData.rank === 'Циклоп') {
        managers.push({ id: userId, username: userData.username || null });
      }
    }
    if (executors.length > 0) {
      availableUsersText += `🔥 *Исполнители (Прометей):*\n`;
      executors.forEach(e => {
        availableUsersText += `• \`${e.id}\`${e.username ? ` (\`@${e.username}\`)` : ''}\n`;
      });
    } else {
      availableUsersText += `🔥 *Исполнители:* _нет назначенных рангов_\n`;
    }
    if (managers.length > 0) {
      availableUsersText += `\n👁️ *Управляющие отделами (Циклоп):*\n`;
      managers.forEach(m => {
        availableUsersText += `• \`${m.id}\`${m.username ? ` (\`@${m.username}\`)` : ''}\n`;
      });
    }
    if (admins.length > 0) {
      availableUsersText += `\n👑 *Администраторы (Посейдон):*\n`;
      admins.forEach(a => {
        availableUsersText += `• \`${a.id}\`${a.username ? ` (\`@${a.username}\`)` : ''}\n`;
      });
    }

    // 🌟 ИСПРАВЛЕНИЕ: устанавливаем состояние и показываем запрос
    ctx.session = ctx.session || {};
    ctx.session.deptState = `dept_executor_id:${orderId}`;
    await ctx.editMessageText(
      `👷 *Назначение исполнителя*\n\n` +
      `📦 *Заказ:* №${order.orderNumber} | ${order.workTitle}\n\n` +
      `Введите Telegram ID исполнителя (число):\n\n` +
      `${availableUsersText}\n` +
      `_Или введите ID любого пользователя вручную_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `dept:view:${orderId}`)]])
      }
    );
  });

  // --- НАПИСАТЬ ЗАКАЗЧИКУ: запрос текста ---
  bot.action(/^dept:msg:(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

    ctx.session = ctx.session || {};
    ctx.session.deptState = `dept_msg_customer:${orderId}`;
    await ctx.editMessageText(
      `💬 Отправка сообщения заказчику\n\n` +
      `Заказ №${order.orderNumber}\n` +
      `Заказчик: ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + order.customerId}\n\n` +
      `Введите текст сообщения:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `dept:view:${orderId}`)]])
      }
    );
  });

  // --- ПРИВЯЗКА К ОТДЕЛУ: запрос выбора чата ---
  bot.action(/^dept:bind_chat:(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

    const chats = loyalty.getManagedChats(ctx.from.id);
    if (chats.length === 0) {
      await ctx.answerCbQuery('❌ Вам не назначены чаты отделов');
      return;
    }

    let text = `🏢 *Привязка заказа к отделу*\n\n`;
    text += `📦 *Заказ:* №${order.orderNumber} | ${order.workTitle}\n\n`;
    text += `Выберите отдел:`;

    const buttons = chats.map((c, idx) => [
      Markup.button.callback(`🏢 ${c.name}`, `dept:bind_chat_set:${orderId}:${idx}`)
    ]);
    buttons.push([Markup.button.callback('⬅️ Назад', `dept:view:${orderId}`)]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // --- ПРИВЯЗКА К ОТДЕЛУ: установка чата ---
  bot.action(/^dept:bind_chat_set:(.+):(\d+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const orderId = ctx.match[1];
    const chatIdx = parseInt(ctx.match[2]);
    const order = ordersDb.getOrder(orderId);
    if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

    const chats = loyalty.getManagedChats(ctx.from.id);
    if (!chats[chatIdx]) { await ctx.answerCbQuery('❌ Отдел не найден'); return; }

    const chatEnv = chats[chatIdx].chatEnv;
    const chatId = process.env[chatEnv];
    if (!chatId) {
      await ctx.answerCbQuery('❌ Переменная окружения не настроена в .env');
      return;
    }

    // Обновляем заказ: привязываем к чату
    ordersDb.updateOrder(orderId, {
      managerChatId: chatId,
      managerChatEnv: chatEnv  // сохраняем имя переменной для надёжности
    });

    logger.logAdminAction('dept_order_bound_to_chat', {
      orderId: orderId,
      orderNumber: order.orderNumber,
      chatEnv: chatEnv,
      departmentName: chats[chatIdx].name,
      managerId: ctx.from.id
    }, ctx);

    await ctx.answerCbQuery(`✅ Заказ привязан к отделу "${chats[chatIdx].name}"`);
    await showOrderCard(ctx, orderId);
  });

  // ==========================================
  // Обработчик текстовых сообщений для отдела
  // ==========================================
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    if (!ctx.session.deptState) {
      await next();
      return;
    }
    if (!isManager(ctx.from.id)) return;

    const state = ctx.session.deptState;
    const text = ctx.message.text;

    // --- НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ ---
    if (state.startsWith('dept_executor_id:')) {
      const orderId = state.split(':')[1];
      const executorId = parseInt(text);
      if (isNaN(executorId)) {
        await ctx.reply('❌ ID должен быть числом. Попробуйте ещё раз или нажмите Отмену.');
        return;
      }
      const order = ordersDb.getOrder(orderId);
      if (!order) {
        await ctx.reply('❌ Заказ не найден');
        ctx.session.deptState = null;
        return;
      }

      const isReassignment = !!order.executorId && String(order.executorId) !== String(executorId);
      const oldExecutorId = order.executorId;
      const orderNumber = order.orderNumber || orderId;

      try {
        // Проверяем существование пользователя
        try {
          await bot.telegram.getChat(executorId);
        } catch (e) {
          throw new Error('Исполнитель с таким ID не найден или заблокировал бота');
        }

        if (order.isCustomOrder) {
          // Кастомный заказ: обновляем поля
          let newStatus;
          if (order.status === 'paid' || order.status === 'completed') {
            newStatus = order.status;
          } else {
            newStatus = 'waiting_price';
          }
          ordersDb.updateOrder(orderId, {
            executorId: executorId,
            executorUsername: null,
            status: newStatus,
            acceptedAt: new Date().toLocaleString('ru-RU')
          });
        } else {
          // Обычный заказ: используем стандартную функцию
          await assignExecutorToOrder(orderId, executorId, bot, isReassignment);
        }

        // Уведомляем старого исполнителя при переназначении
        if (isReassignment && oldExecutorId) {
          try {
            await bot.telegram.sendMessage(oldExecutorId,
              `⚠️ *Заказ передан другому исполнителю*\n\n` +
              `🆔 *Номер заказа:* №${orderNumber}\n` +
              `📚 *Работа:* ${order.workTitle}\n\n` +
              `Управляющий отделом назначил нового исполнителя.`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {
            console.log('Не удалось уведомить старого исполнителя:', e.message);
          }
        }

        logger.logAdminAction('dept_executor_assigned', {
          orderId: orderId,
          orderNumber: orderNumber,
          newExecutorId: executorId,
          oldExecutorId: oldExecutorId || null,
          managerId: ctx.from.id
        }, ctx);

        await ctx.reply(
          `✅ *Исполнитель успешно назначен!*\n\n` +
          `📦 *Заказ:* №${orderNumber}\n` +
          `👷 *ID исполнителя:* \`${executorId}\``,
          { parse_mode: 'Markdown' }
        );

        await showOrderCard(ctx, orderId);
      } catch (err) {
        await ctx.reply(
          `❌ *Ошибка назначения:*\n\n${err.message}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Вернуться к заказу', `dept:view:${orderId}`)]])
          }
        );
      }

      ctx.session.deptState = null;
      return;
    }

    // --- ОТПРАВКА СООБЩЕНИЯ ЗАКАЗЧИКУ ---
    if (state.startsWith('dept_msg_customer:')) {
      const orderId = state.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) {
        await ctx.reply('❌ Заказ не найден');
        ctx.session.deptState = null;
        return;
      }

      try {
        await ctx.telegram.sendMessage(
          order.customerId,
          `📬 *Сообщение от руководителя отдела по заказу №${order.orderNumber}*\n\n${text}`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Сообщение отправлено заказчику ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + order.customerId}`);
      } catch (err) {
        await ctx.reply(`❌ Не удалось отправить сообщение: ${err.message}`);
      }

      ctx.session.deptState = null;
      return;
    }

    await next();
  });
}

module.exports = { register };