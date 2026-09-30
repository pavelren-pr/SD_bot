const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const orders = require('../data/orders');
const ordersDb = require('../data/orders');
const { createInlineKeyboard } = require('../utils/keyboard');
const logger = require('../utils/logger');
const storage = require('../utils/storage');
const { Markup } = require('telegraf');

const mediaBuffer = {};
const activeChats = new Map();

// 🌟 Функция восстановления данных чата после перезапуска бота
function restoreChatData(chatId) {
  if (activeChats.has(chatId)) return activeChats.get(chatId);

  // 1. Ищем заказ в БД по сохраненному chatId (если он там есть)
  const allOrders = orders.getAllOrders();
  let order = allOrders.find(o => o.chatId === chatId && o.executorId);

  // 2. Если не нашли по chatId, пытаемся восстановить его из формата: order_customerId_workId_timestamp
  if (!order) {
    const parts = chatId.split('_');
    if (parts[0] === 'order' && parts.length >= 3) {
      const customerUserId = parseInt(parts[1]);
      const lastPart = parts[parts.length - 1];
      const workId = (!isNaN(lastPart) && lastPart.length >= 10) ? parts.slice(2, -1).join('_') : parts.slice(2).join('_');

      const userOrders = orders.getUserOrders(customerUserId);
      // Ищем заказы с нужной работой, у которых уже есть исполнитель
      const matchingOrders = userOrders.filter(o => o.workId === workId && o.executorId);
      if (matchingOrders.length > 0) {
        order = matchingOrders[matchingOrders.length - 1]; // Берем самый свежий
      }
    }
  }

  if (!order) return null; // Если заказ так и не найден, возвращаем null

  // Создаём объект чата заново и сохраняем его обратно в activeChats
  const chatData = {
    chatId: chatId,
    customerUserId: parseInt(order.customerId),
    executorUserId: parseInt(order.executorId),
    workId: order.workId,
    workTitle: order.workTitle,
    orderId: order.id,
    orderNumber: order.orderNumber || '—',
    status: 'idle',
    createdAt: Date.now()
  };

  activeChats.set(chatId, chatData);
  return chatData;
}

// 🌟 Функция формирования текста сообщения в группе исполнителей
function buildGroupOrderText(order, status) {
    let header;
    if (status === 'new') header = '🔔 *НОВЫЙ ЗАКАЗ!*';
    else if (status === 'in_progress') header = '🔨 *ЗАКАЗ В РАБОТЕ*';
    else header = '✅ *ЗАКАЗ ВЫПОЛНЕН*';
    
    const esc = (s) => s ? String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&') : '';
    const commissionPercent = order.commission || 0;
    const executorPrice = Math.round(order.price * (1 - commissionPercent / 100));
    const userLink = order.customerUsername 
        ? `@${order.customerUsername}` 
        : `[Пользователь](tg://user?id=${order.customerId})`;
    
    let text = `${header}\n\n`;
    text += `🆔 *Номер заказа:* №${order.orderNumber}\n`;
    text += `👤 *Заказчик:* ${userLink}\n`;
    text += `📚 *Работа:* ${esc(order.workTitle)}\n`;
    text += `💰 *Сумма:* ${order.price} ₽\n`;
    text += `👷 *Исполнитель получит:* ${executorPrice} ₽ (комиссия ${commissionPercent}%)\n`;
    
    if (order.executorUsername || order.executorId) {
        const executorDisplay = order.executorUsername 
            ? `@${order.executorUsername}` 
            : `ID: ${order.executorId}`;
        text += `👷 *Исполнитель:* ${executorDisplay}\n`;
    }
    
    text += `\n⏰ *Создан:* ${order.createdAt}`;
    
    if (order.acceptedAt) {
        text += `\n🔨 *Принят:* ${order.acceptedAt}`;
    }
    if (order.completedAt) {
        text += `\n✅ *Выполнен:* ${order.completedAt}`;
    }
    
    // Статус
    if (status === 'new') text += `\n🟢 *Статус:* ОПЛАЧЕН — ОЖИДАЕТ ПРИНЯТИЯ`;
    else if (status === 'in_progress') text += `\n🟡 *Статус:* В РАБОТЕ`;
    else text += `\n🟢 *Статус:* ВЫПОЛНЕН`;
    
    return text;
}

// 🌟 Подпись сообщения-скриншота в чате исполнителей
function buildExecutorOrderCaption(order) {
  const esc = (s) => s ? String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&') : '';
  const commissionPercent = order.commission || 0;
  const executorPrice = Math.round(order.price * (1 - commissionPercent / 100));
  const userLink = order.customerUsername ? `@${order.customerUsername}` : `[Пользователь](tg://user?id=${order.customerId})`;
  let text = `🔔 *НОВЫЙ ЗАКАЗ!*\n\n`;
  text += `🆔 *Номер заказа:* №${order.orderNumber}\n`;
  text += `👤 *Заказчик:* ${userLink}\n`;
  text += `📚 *Работа:* ${esc(order.workTitle)}\n`;
  text += `💰 *Сумма:* ${order.price} ₽\n`;
  text += `👷 *Исполнитель получит:* ${executorPrice} ₽ (комиссия ${commissionPercent}%)\n`;
  text += `⏰ *Создан:* ${order.createdAt}\n`;
  text += `🟢 *Статус:* ОПЛАЧЕН — ОЖИДАЕТ ПРИНЯТИЯ`;
  return text;
}

function buildExecutorOrderKeyboard(order, chatId) {
  const buttons = [];
  // Проверяем как обычные заказы (detailsText), так и индивидуальные (description)
  if (order.detailsText || order.description) {
  buttons.push([Markup.button.callback('📝 Исходные данные', `order_data:${order.id}`)]);
  }
  // Проверяем массив файлов или одиночный файл (fileId)
  if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) {
  buttons.push([Markup.button.callback(`📎 Файлы задания`, `order_files:${order.id}:0`)]);
  }
  buttons.push([Markup.button.callback('✅ Принять заказ', `ao:${chatId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Функция экранирования специальных символов Markdown
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function getChatKeyboard(chatId, isCustomer) {
  const replyText = isCustomer ? '✏️ Написать исполнителю' : '✏️ Ответить заказчику';
  const replyCallback = isCustomer ? `cr:${chatId}` : `er:${chatId}`;
  const fileText = '📎 Отправить файл/фото';
  const fileCallback = isCustomer ? `csf:${chatId}` : `esf:${chatId}`;
  const closeText = '❌ Завершить чат';
  const closeCallback = isCustomer ? `ccc:${chatId}` : `ecc:${chatId}`;

  return createInlineKeyboard([
    [{ text: replyText, callback: replyCallback }],
    [{ text: fileText, callback: fileCallback }],
    [{ text: closeText, callback: closeCallback }]
  ]).reply_markup;
}

function register(bot) {
  bot.action(/^order:start:(.+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    if (work && work.isCustomOrder) {
      return;
    }
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    let message = `📎 Отлично!\n\n${escapeMarkdown(work.prompt)}`;
    // 🌟 Добавляем ссылку на примеры работ, если она есть в каталоге
    if (work.exampleUrl) {
      message += `\n\n📚 Пример работы и методические указания доступны по [ссылке](${work.exampleUrl})`;
    }
    await ctx.editMessageText(message, { parse_mode: 'Markdown' });
  });

  // 🌟 Показать исходные данные (редактируем подпись)
  bot.action(/^order_data:(.+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    const backKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Подтверждение оплаты / Назад', `order_back:${order.id}`)]
    ]);
    const textToShow = order.detailsText || order.description || 'Нет данных';
    const dataCaption = `📝 *Исходные данные к заказу №${order.orderNumber}*\n\n${textToShow}`.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

    try {
      await ctx.telegram.editMessageCaption(
        order.managerChatId, order.managerMessageId, null,
        dataCaption,
        { parse_mode: 'Markdown', reply_markup: backKeyboard.reply_markup }
      );
      await ctx.answerCbQuery();
      } catch (e) {
        if (e.message && e.message.includes('message is not modified')) {
          // Ничего не меняем — сообщение уже показывает эти данные
          return ctx.answerCbQuery();
        }
        // Реальная ошибка (лимит подписи и т.д.) — отправляем отдельным сообщением
        await ctx.telegram.sendMessage(order.managerChatId, dataCaption, { parse_mode: 'Markdown' });
        await ctx.answerCbQuery('Данные отправлены отдельным сообщением');
      }
  });

  // 🌟 Показать файлы задания (заменяем скриншот файлом)
  bot.action(/^order_files:(.+):(\d+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    const fileIdx = parseInt(ctx.match[2]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    let files = order.taskFiles || [];
    // Fallback для индивидуальных заказов, где файл хранится в другом поле
    if (files.length === 0 && order.fileId) {
      files = [{ type: order.fileType || 'document', fileId: order.fileId, fileName: order.fileName || 'Файл задания' }];
    }
    if (files.length === 0) return ctx.answerCbQuery('📭 Файлов нет');
    const file = files[fileIdx];

    const navRow = [];
    navRow.push(fileIdx > 0 ? Markup.button.callback('◀️', `order_files:${order.id}:${fileIdx - 1}`) : Markup.button.callback('·', 'noop'));
    navRow.push(Markup.button.callback(`${fileIdx + 1}/${files.length}`, 'noop'));
    navRow.push(fileIdx < files.length - 1 ? Markup.button.callback('▶️', `order_files:${order.id}:${fileIdx + 1}`) : Markup.button.callback('·', 'noop'));

    const keyboard = Markup.inlineKeyboard([
      navRow,
      [Markup.button.callback('💳 Подтверждение оплаты / Назад', `order_back:${order.id}`)]
    ]);

    try {
      await ctx.telegram.editMessageMedia(
        order.managerChatId, order.managerMessageId, null,
        {
          type: file.type === 'photo' ? 'photo' : 'document',
          media: file.fileId,
          caption: `📎 Файл ${fileIdx + 1}/${files.length}: ${(file.fileName || 'Файл задания').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')}`,
          reply_markup: keyboard.reply_markup
        }
      );
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Не удалось показать файл:', e.message);
      await ctx.answerCbQuery('Не удалось показать файл');
    }
  });


  // 🌟 Назад — вернуть скриншот оплаты и исходную подпись
  bot.action(/^order_back:(.+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    const caption = buildExecutorOrderCaption(order);
    const chatIdForBtn = order.chatId || `order_${order.customerId}_${order.workId}`;
    const keyboard = buildExecutorOrderKeyboard(order, chatIdForBtn);

    // 1) Если сообщение — фото/документ: возвращаем подпись через editMessageCaption (надёжно!)
    if (order.screenshotFileId) {
      try {
        await ctx.telegram.editMessageCaption(
          order.managerChatId, order.managerMessageId, null,
          caption,
          { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
        );
        return ctx.answerCbQuery();
      } catch (e) {
        if (e.message && e.message.includes('message is not modified')) return ctx.answerCbQuery();
        // повтор без Markdown
        try {
          await ctx.telegram.editMessageCaption(
            order.managerChatId, order.managerMessageId, null,
            caption,
            { reply_markup: keyboard.reply_markup }
          );
          return ctx.answerCbQuery();
        } catch (e2) { /* идём к запасному варианту */ }
      }
    }

    // 2) Если сообщение текстовое
    try {
      await ctx.telegram.editMessageText(
        order.managerChatId, order.managerMessageId, null,
        caption,
        { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
      );
      return ctx.answerCbQuery();
    } catch (e) {
      if (e.message && e.message.includes('message is not modified')) return ctx.answerCbQuery();
      try {
        await ctx.telegram.editMessageText(
          order.managerChatId, order.managerMessageId, null,
          caption,
          { reply_markup: keyboard.reply_markup }
        );
        return ctx.answerCbQuery();
      } catch (e2) { /* идём к запасному варианту */ }
    }

    // 3) Запасной вариант: удалить старое и отправить новое с кнопками
    try {
      try { await ctx.telegram.deleteMessage(order.managerChatId, order.managerMessageId); } catch (_) {}
      let sent;
      if (order.screenshotFileId) {
        sent = order.screenshotType === 'document'
          ? await ctx.telegram.sendDocument(order.managerChatId, order.screenshotFileId, { caption, reply_markup: keyboard.reply_markup })
          : await ctx.telegram.sendPhoto(order.managerChatId, order.screenshotFileId, { caption, reply_markup: keyboard.reply_markup });
      } else {
        sent = await ctx.telegram.sendMessage(order.managerChatId, caption, { reply_markup: keyboard.reply_markup });
      }
      orders.updateOrder(order.id, { managerMessageId: sent.message_id });
      return ctx.answerCbQuery();
    } catch (e3) {
      return ctx.answerCbQuery('Не удалось обновить сообщение');
    }
  });

  bot.on(['text', 'photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    // 🌟 ПЕРВАЯ ПРОВЕРКА: Если пользователь в админ-панели — передаём управление admin.js
    if (ctx.session.adminState) {
      await next();
      return;
    }
    // 🌟 НОВОЕ: Если управляющий (Циклоп) в режиме ввода (исполнитель/сообщение заказчику) — передаём управление department.js
    if (ctx.session.deptState) {
      await next();
      return;
    }
    // 🌟 0.1 АДМИН ПИШЕТ ЗАКАЗЧИКУ
    if (ctx.session.adminReplyToCustomerId) {
      const targetUserId = ctx.session.adminReplyToCustomerId;
      const orderId = ctx.session.adminReplyOrderId;

      const dbOrder = ordersDb.getOrder(orderId);

      const orderTitle =
        ctx.session.adminReplyOrderTitle ||
        (dbOrder ? dbOrder.workTitle : 'Заказ');

      const orderDate =
        ctx.session.adminReplyOrderDate ||
        (dbOrder ? dbOrder.createdAt : '—');

      const orderNumber =
        ctx.session.adminReplyOrderNumber ||
        (dbOrder && dbOrder.orderNumber ? dbOrder.orderNumber : orderId);

      const adminId =
        ctx.session.adminReplyAdminId || ctx.from.id;

      const rawMessageText =
        ctx.message.text ||
        ctx.message.caption ||
        '[Фото/Файл]';

      const messageText = escapeMarkdown(rawMessageText);
      const safeOrderTitle = escapeMarkdown(orderTitle);

      const adminReplyKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✏️ Ответить администратору',
            `admin_reply:${targetUserId}_${orderId}_${adminId}`
          )
        ]
      ]);

      await ctx.telegram.sendMessage(
        targetUserId,
        `💬 *Вам сообщение от администратора*\n\n` +
        `🆔 *Номер заказа:* №${orderNumber}\n` +
        `📚 *Заказ:* ${safeOrderTitle}\n` +
        `📅 *Дата заказа:* ${orderDate}\n\n` +
        `${messageText}`,
        {
          parse_mode: 'Markdown',
          reply_markup: adminReplyKeyboard.reply_markup
        }
      );

      if (ctx.message.photo) {
        await ctx.telegram.sendPhoto(
          targetUserId,
          ctx.message.photo[ctx.message.photo.length - 1].file_id
        );
      } else if (ctx.message.document) {
        await ctx.telegram.sendDocument(
          targetUserId,
          ctx.message.document.file_id
        );
      }

      await ctx.reply(`✅ Сообщение отправлено заказчику (ID: ${targetUserId})`);

      ctx.session.adminReplyToCustomerId = null;
      ctx.session.adminReplyOrderId = null;
      ctx.session.adminReplyOrderNumber = null;
      ctx.session.adminReplyOrderTitle = null;
      ctx.session.adminReplyOrderDate = null;
      ctx.session.adminReplyAdminId = null;

      return;
    }

      // 🌟 0.12 ЗАКАЗЧИК ПИШЕТ АДМИНУ (ответ на сообщение от администрации)
      if (ctx.session.customerReplyToAdminId) {
        const adminId = ctx.session.customerReplyToAdminId;
        const orderId = ctx.session.customerReplyToAdminOrderId;
        const orderNumber = ctx.session.customerReplyToAdminOrderNumber || '—';
        const orderTitle = ctx.session.customerReplyToAdminOrderTitle || 'Заказ';
        const messageText = ctx.message.text || '[Фото/Файл]';
        const customerUsername = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
        // 🌟 Клавиатура с кнопкой ответа заказчику
        const replyKeyboard = Markup.inlineKeyboard([[
          Markup.button.callback('✏️ Ответить заказчику', `admin_reply_to_customer:${ctx.from.id}_${orderId}`)
        ]]);
        try {
          await ctx.telegram.sendMessage(
            adminId,
            `💬 *Ответ заказчика по заказу №${orderNumber}*\n\n👤 *Заказчик:* ${customerUsername}\n📚 *Заказ:* ${orderTitle}\n\n${messageText}`,
            { parse_mode: 'Markdown', reply_markup: replyKeyboard.reply_markup }
          );
          if (ctx.message.photo) {
            await ctx.telegram.sendPhoto(adminId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
          } else if (ctx.message.document) {
            await ctx.telegram.sendDocument(adminId, ctx.message.document.file_id);
          }
          await ctx.reply(`✅ Ваш ответ отправлен администратору`);
        } catch (err) {
          await ctx.reply(`❌ Не удалось отправить сообщение администратору: ${err.message}`);
        }
        // Очищаем session
        ctx.session.customerReplyToAdminId = null;
        ctx.session.customerReplyToAdminOrderId = null;
        ctx.session.customerReplyToAdminOrderNumber = null;
        ctx.session.customerReplyToAdminOrderTitle = null;
        return;
      }

    // 🌟 0.15 ИСПОЛНИТЕЛЬ ПИШЕТ ЗАКАЗЧИКУ
    if (ctx.session.executorReplyToCustomerId) {
      const targetUserId = ctx.session.executorReplyToCustomerId;
      const orderTitle = ctx.session.executorReplyOrderTitle;
      const orderDate = ctx.session.executorReplyOrderDate;
      const orderNumber = ctx.session.executorReplyOrderNumber || '—';
      const messageText = ctx.message.text || '[Фото/Файл]';
      
      // 🌟 Клавиатура для ответа заказчику (session-based, не зависит от activeChats)
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить исполнителю', `customer_reply_msg:${ctx.from.id}_${orderNumber}`)],
        [Markup.button.callback('📎 Отправить файл исполнителю', `customer_reply_file:${ctx.from.id}_${orderNumber}`)]
      ]);
      
      await ctx.telegram.sendMessage(
        targetUserId,
        `💬 *Вам сообщение от исполнителя*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Заказ:* ${orderTitle}\n📅 *Дата заказа:* ${orderDate}\n\n${messageText}`,
        { parse_mode: 'Markdown', ...keyboard }
      );
      if (ctx.message.photo) {
        await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
      } else if (ctx.message.document) {
        await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
      }
      await ctx.reply(`✅ Сообщение отправлено заказчику`);
      
      // Очищаем session
      ctx.session.executorReplyToCustomerId = null;
      ctx.session.executorReplyOrderId = null;
      ctx.session.executorReplyOrderTitle = null;
      ctx.session.executorReplyOrderDate = null;
      ctx.session.executorReplyOrderNumber = null;
      return;
    }

    // 🌟 0.2 ЗАКАЗЧИК ПИШЕТ ИСПОЛНИТЕЛЮ
    if (ctx.session.customerReplyToExecutorId) {
      const targetUserId = ctx.session.customerReplyToExecutorId;
      const orderTitle = ctx.session.customerReplyOrderTitle;
      const orderDate = ctx.session.customerReplyOrderDate;
      const orderNumber = ctx.session.customerReplyOrderNumber || '—';
      const orderId = ctx.session.customerReplyOrderId;
      const chatId = ctx.session.customerReplyChatId; // 🌟 Используем сохранённый chatId
      const messageText = ctx.message.text || '[Фото/Файл]';

  // 🌟 Проверяем, существует ли чат в activeChats
  let chatData = activeChats.get(chatId);
  
  // Если чата нет в activeChats, создаём его
  if (!chatData) {
    // Получаем workId из chatId (формат: order_customerId_workId)
    const parts = chatId.split('_');
    const workId = parts.slice(2).join('_');
    const work = catalog.getWork(workId);
    
    if (!work) {
      await ctx.reply('❌ Ошибка: работа не найдена');
      ctx.session.customerReplyToExecutorId = null;
      ctx.session.customerReplyOrderId = null;
      ctx.session.customerReplyOrderTitle = null;
      ctx.session.customerReplyOrderDate = null;
      ctx.session.customerReplyOrderNumber = null;
      ctx.session.customerReplyChatId = null;
      return;
    }
    
    // Создаём новый чат в activeChats
    chatData = {
      chatId: chatId,
      customerUserId: ctx.from.id,
      executorUserId: targetUserId,
      workId: workId,
      workTitle: work.title,
      orderId: orderId,
      orderNumber: orderNumber,
      status: 'waiting_executor_message',
      createdAt: Date.now()
    };
    activeChats.set(chatId, chatData);
  }


    // 🌟 Session-based клавиатура (не зависит от activeChats)
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить заказчику', `executor_reply_msg2:${ctx.from.id}_${orderNumber}`)],
      [Markup.button.callback('📎 Отправить файл заказчику', `executor_reply_file2:${ctx.from.id}_${orderNumber}`)]
    ]);

  await ctx.telegram.sendMessage(
    targetUserId,
    `💬 *Вам сообщение от заказчика*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Заказ:* ${orderTitle}\n📅 *Дата заказа:* ${orderDate}\n\n${messageText}`,
    { parse_mode: 'Markdown', ...keyboard }
  );

  if (ctx.message.photo) {
    await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
  } else if (ctx.message.document) {
    await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
  }

  await ctx.reply(`✅ Сообщение отправлено исполнителю`);

  // Очищаем session
  ctx.session.customerReplyToExecutorId = null;
  ctx.session.customerReplyOrderId = null;
  ctx.session.customerReplyOrderTitle = null;
  ctx.session.customerReplyOrderDate = null;
  ctx.session.customerReplyOrderNumber = null;
  ctx.session.customerReplyChatId = null;
  return;
}
    
    // 🌟 ПРОВЕРКА: Если пользователь в админ-панели — передаём управление admin.js
    if (ctx.session.adminState) {
      console.log('⚙️ Сообщение перехвачено админ-панелью, передаём управление admin.js');
      await next();
      return;
    }
    
    // 🌟 Менеджер пишет ответ пользователю из поддержки
    if (ctx.session.replyToUserId) {
      console.log('✅ Режим ответа активен! Отправляем пользователю:', ctx.session.replyToUserId);
      const targetUserId = ctx.session.replyToUserId;
      const targetUsername = ctx.session.replyToUsername || 'неизвестно';
      const messageText = ctx.message.text || '[Фото/Файл]';
      
      await ctx.telegram.sendMessage(targetUserId, `💬 *Сообщение от менеджера:*\n\n${messageText}`, { parse_mode: 'Markdown' });
      if (ctx.message.photo) await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
      else if (ctx.message.document) await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
      
      await ctx.reply(`✅ Ответ успешно отправлен пользователю @${targetUsername} (ID: ${targetUserId})`);
      ctx.session.replyToUserId = null;
      ctx.session.replyToUsername = null;
      return;
    }

    if (ctx.chat?.type !== 'private' || ctx.from?.is_bot) return;
    
    const order = ctx.session.order;

    // Пропускаем если это индивидуальный заказ (обрабатывается в custom_order.js)
    if (order && ctx.session.customOrder) {
      return next();
    }

    const executorChat = findExecutorChat(ctx.from.id);
    if (executorChat && (executorChat.status === 'waiting_executor_message' || executorChat.status === 'waiting_executor_file')) {
      await handleExecutorMessage(ctx, executorChat);
      return;
    }

    const customerChat = findCustomerChat(ctx.from.id);
    if (customerChat && (customerChat.status === 'waiting_customer_message' || customerChat.status === 'waiting_customer_file')) {
      await handleCustomerMessage(ctx, customerChat);
      return;
    }

  if (order && order.step === 'waiting_details') {
    const work = catalog.getWork(order.workId);
    const needsText = work.needs.includes('details') || work.needs.includes('variant');
    const needsFile = work.needs.includes('photo');
    
    if (ctx.message.text) {
      order.details.text = ctx.message.text;
      // 🌟 Если нужен файл и его ещё нет — ждём файл
      if (needsFile && order.details.files.length === 0) {
        await ctx.reply('✅ Текст принят! Теперь прикрепите файл(ы) с заданием 📎');
        return;
      }
      await showConfirmation(ctx);
      return;
    }
    let fileInfo = null;
    if (ctx.message.photo) fileInfo = { type: 'photo', fileId: ctx.message.photo[ctx.message.photo.length - 1].file_id };
    else if (ctx.message.document) fileInfo = { type: 'document', fileId: ctx.message.document.file_id, fileName: ctx.message.document.file_name || 'Документ' };
    if (!fileInfo) return;
    if (ctx.message.media_group_id) {
      const groupId = ctx.message.media_group_id;
      if (!mediaBuffer[groupId]) mediaBuffer[groupId] = { files: [], ctx, timer: null };
      const buffer = mediaBuffer[groupId];
      buffer.files.push(fileInfo);
      if (buffer.timer) clearTimeout(buffer.timer);
      buffer.timer = setTimeout(async () => {
        for (const file of buffer.files) {
          if (file.type === 'photo') file.fileName = `Фото ${order.details.files.length + 1}.jpg`;
          order.details.files.push(file);
        }
        delete mediaBuffer[groupId];
        // 🌟 После получения файлов проверяем, нужен ли текст
        if (needsText && !order.details.text) {
          await ctx.reply('✅ Файлы приняты! Теперь отправьте текстовые данные ✍️');
        } else {
          await showConfirmation(ctx);
        }
      }, 1000);
      return;
    }
    if (fileInfo.type === 'photo') fileInfo.fileName = `Фото ${order.details.files.length + 1}.jpg`;
    order.details.files.push(fileInfo);
    // 🌟 Если нужен текст и его ещё нет — ждём текст
    if (needsText && !order.details.text) {
      await ctx.reply('✅ Файл принят! Теперь отправьте текстовые данные ✍️');
      return;
    }
    await showConfirmation(ctx);
    return;
  }

  if (order && order.step === 'awaiting_payment') {
    const work = catalog.getWork(order.workId);
    const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
    const displayName = (ctx.from.first_name || 'Пользователь').replace(/[_*[]()~`>#+-=|{}.!]/g, '');
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${displayName}](tg://user?id=${ctx.from.id})`;

    try {
      const now = new Date();
      const paidTime = now.toLocaleString('ru-RU');
      order.status = 'paid'; order.paidAt = paidTime; order.step = 'completed';
      loyalty.addToTotal(ctx.from.id, ctx.from.username, order.finalPrice);

      const subject = catalog.getSubject(work.subjectId);
      const course = catalog.getCourse(subject.courseId);
      const chatId = ctx.session.order.chatId || `order_${ctx.from.id}_${order.workId}_${Date.now()}`;

      // 🌟 Сначала создаём заказ в БД, чтобы получить orderNumber
      const newOrder = orders.createOrder({
        workId: work.id,
        workTitle: work.title,
        subjectName: subject.name,
        courseName: course.name,
        customerId: ctx.from.id,
        customerUsername: ctx.from.username || null,
        price: order.finalPrice,
        commission: work.commission,
        createdAt: paidTime,
        managerChatId: targetChatId,
        // 🌟 Сохраняем данные для кнопок
        detailsText: order.details.text || null,
        taskFiles: order.details.files || [],
        chatId: chatId
      });
      ctx.session.currentOrderId = newOrder.id;
      logger.logOrderEvent('created', newOrder, ctx.from.id, ctx.from.username);

      const commissionPercent = work.commission || 0;
      const executorPrice = Math.round(order.finalPrice * (1 - commissionPercent / 100));

      // 🌟 Подпись сообщения (информация о заказе)
      const caption = buildExecutorOrderCaption(newOrder);
      // 🌟 Клавиатура с кнопками просмотра — передаём данные напрямую,
      // не полагаясь на то, что вернул createOrder
      const orderForKeyboard = {
        id: newOrder.id,
        orderNumber: newOrder.orderNumber,
        detailsText: order.details.text || null,
        taskFiles: order.details.files || []
      };
      const keyboard = buildExecutorOrderKeyboard(orderForKeyboard, chatId);

      // 🌟 Отправляем СООБЩЕНИЕ-СКРИНШОТ в чат исполнителей
      let sentMsg;
      const screenshotPhoto = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : null;
      const screenshotDoc = ctx.message.document ? ctx.message.document.file_id : null;

      if (screenshotPhoto) {
        sentMsg = await ctx.telegram.sendPhoto(targetChatId, screenshotPhoto, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { screenshotFileId: screenshotPhoto, screenshotType: 'photo', managerMessageId: sentMsg.message_id });
      } else if (screenshotDoc) {
        sentMsg = await ctx.telegram.sendDocument(targetChatId, screenshotDoc, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { screenshotFileId: screenshotDoc, screenshotType: 'document', managerMessageId: sentMsg.message_id });
      } else {
        // Скриншота нет — отправляем обычное текстовое сообщение
        sentMsg = await ctx.telegram.sendMessage(targetChatId, caption, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { managerMessageId: sentMsg.message_id });
      }

      // 🌟 Кнопка связи с менеджером
      const managerUsername = process.env.MANAGER_USERNAME || 'SmartDealsManager';
      const waitingKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('👨‍💼 Связаться с менеджером', `https://t.me/${managerUsername}`)]
      ]);
      await ctx.reply(
        `✅ *Заказ оформлен и ожидает назначения исполнителя.*\n\n` +
        `🆔 *Номер заказа:* №${newOrder.orderNumber}\n\n` +
        `📚 *Работа:* ${work.title}\n` +
        `💰 *Сумма:* ${order.finalPrice} ₽\n\n` +
        `Мы уже ищем для вас лучшего специалиста.\nЕсли у вас есть срочные вопросы, нажмите кнопку ниже:`,
        { parse_mode: 'Markdown', reply_markup: waitingKeyboard.reply_markup }
      );
    } catch (error) {
      console.error('Ошибка обработки оплаты:', error);
      logger.logError(error, ctx);
      await ctx.reply('❌ Произошла ошибка. Напишите нам напрямую.');
    }
    return;
  }

    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
    
    try {
      const supportReplyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✏️ Ответить ${userLink}`, `support_reply:${ctx.from.id}`)]
      ]);

      await ctx.telegram.sendMessage(supportChatId, `📩 *Новое сообщение от пользователя*\n👤 ${userLink}\n\nСообщение переслано ниже 👇`, { 
        parse_mode: 'Markdown', reply_markup: supportReplyKeyboard.reply_markup 
      });
      
      await ctx.forwardMessage(supportChatId, ctx.chat.id, ctx.message.message_id);
      await ctx.reply('📩 Сообщение отправлено менеджеру');
    } catch (error) {
      console.error('Ошибка пересылки в поддержку:', error);
      logger.logError(error, ctx); // 🌟
      // 🌟 Уведомляем поддержку об ошибке (без кнопки ответа, чтобы не зациклиться)
      await logger.notifyErrorToSupport(error, ctx, bot, {
        action: 'Пересылка сообщения в поддержку'
      });
      await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }
  });

  bot.action(/^support_reply:(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      const user = await ctx.telegram.getChat(targetUserId);
      const username = user.username || 'неизвестно';

      ctx.session = ctx.session || {};
      ctx.session.replyToUserId = targetUserId;
      ctx.session.replyToUsername = username;
      
      await ctx.editMessageText(
        `✏️ *Режим ответа*\n\nНапишите сообщение или прикрепите файл, которое будет отправлено пользователю @${username} (ID: \`${targetUserId}\`).\n\nЧтобы отменить, нажмите /start`, 
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCbQuery('✅ Готов к отправке ответа');
    } catch (error) {
      console.error('❌ Ошибка в обработчике support_reply:', error);
      await ctx.answerCbQuery('❌ Ошибка. Попробуйте ещё раз').catch(() => {});
    }
  });

  async function showConfirmation(ctx) {
    const order = ctx.session.order;
    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);
    let summary = '🛒 *Подтверждение заказа*\n\n';
    summary += `📌 *Работа:* ${work.title}\n💵 *Базовая цена:* ${pricing.basePrice} ₽\n`;
    if (pricing.discountPercent > 0) summary += `🎉 *Ваша скидка:* -${pricing.discountPercent}%\n`;
    summary += `✅ *Итого к оплате:* ${pricing.finalPrice} ₽\n\n`;
    if (order.details.text) summary += `📝 *Ваши данные:*\n\`${order.details.text}\`\n\n`;
    if (order.details.files.length > 0) {
      summary += `📎 *Принято файлов:* ${order.details.files.length}\n`;
      order.details.files.forEach(file => { summary += `• ${escapeMarkdown(file.fileName)}\n`; });
      summary += '\n';
    }
    summary += 'Проверьте данные и нажмите кнопку ниже.';
    const buttons = [[{ text: '💳 Подтвердить и оплатить', callback: 'order:confirm' }]];
    if (order.details.text) buttons.push([{ text: '✏️ Изменить данные', callback: 'order:edit_text' }]);
    if (order.details.files.length > 0) buttons.push([{ text: '📎 Изменить вложение', callback: 'order:edit_files' }]);
    await ctx.reply(summary, { parse_mode: 'Markdown', reply_markup: createInlineKeyboard(buttons).reply_markup });
  }

  bot.action('order:edit_text', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');
    order.details.text = null; order.step = 'waiting_details';
    await ctx.editMessageText(`✏️ *Редактирование данных*\n\n${catalog.getWork(order.workId).prompt}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('order:edit_files', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');
    order.details.files = []; order.step = 'waiting_details';
    await ctx.editMessageText(`📎 *Загрузка вложений*\n\n${catalog.getWork(order.workId).prompt}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('order:confirm', async (ctx) => {
    ctx.session = ctx.session || {};
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден.');
    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);
    const paymentDetails = process.env[work.paymentEnv] || 'Не указан';
    const createdAt = new Date().toLocaleString('ru-RU');

    // 🌟 Уведомление ТОЛЬКО в поддержку (не в чат исполнителей)
    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const subject = catalog.getSubject(work.subjectId);
    const course = catalog.getCourse(subject.courseId);
    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || 'Пользователь';

    let supportText = `🔔 *НОВЫЙ ЗАКАЗ (ожидает оплаты)*\n\n`;
    supportText += `🎓 *Курс:* ${course.name}\n`;
    supportText += `📖 *Предмет:* ${subject.name}\n`;
    supportText += `📚 *Работа:* ${work.title}\n`;
    supportText += `👤 *Заказчик:* ${userDisplay}\n`;
    supportText += `🆔 *ID:* \`${ctx.from.id}\`\n`;
    supportText += `💰 *Сумма:* ${pricing.finalPrice} ₽\n`;
    supportText += `⏰ *Создан:* ${createdAt}\n`;
    supportText += `🟡 *Статус:* ОЖИДАЕТ ОПЛАТЫ`;

    const supportButtons = [];
    if (ctx.from.username) {
      supportButtons.push([Markup.button.url('💬 Написать заказчику', `https://t.me/${ctx.from.username}`)]);
    }
    supportButtons.push([Markup.button.callback('✏️ Ответить заказчику', `support_reply:${ctx.from.id}`)]);

    try {
      await ctx.telegram.sendMessage(supportChatId, supportText, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(supportButtons).reply_markup
      });
    } catch (e) {
      console.error('Не удалось отправить уведомление в поддержку:', e.message);
    }

    // 🌟 ВАЖНО: НЕ отправляем в чат исполнителей и НЕ создаём там сообщение.
    // Сохраняем состояние для этапа оплаты.
    const uniqueChatId = `order_${ctx.from.id}_${order.workId}_${Date.now()}`;
    order.chatId = uniqueChatId;
    order.createdAt = createdAt;
    order.finalPrice = pricing.finalPrice;
    order.discountPercent = pricing.discountPercent;
    order.paymentDetails = paymentDetails;
    order.step = 'awaiting_payment';
    // managerMessageId пока не существует — он появится только после оплаты

    await ctx.reply(
      `✅ *Заказ успешно оформлен!*\n\nДля завершения переведите *${pricing.finalPrice} ₽* на карту/телефон:\n\`${paymentDetails}\`\n\n📸 *После оплаты просто пришлите скриншот чека в этот чат*, и заказ поступит в работу! 🚀`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery('✅ Заказ отправлен!');
  });

  bot.action(/^ao:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const executorUserId = ctx.from.id;
    const parts = chatId.split('_');
    const customerUserId = parseInt(parts[1]);
    
    // 🌟 Поддержка старого и нового формата chatId (с timestamp и без)
    const lastPart = parts[parts.length - 1];
    let workId;
    if (!isNaN(lastPart) && lastPart.length >= 10) {
      // Новый формат: order_customerId_workId_with_underscores_timestamp
      workId = parts.slice(2, -1).join('_');
    } else {
      // Старый формат: order_customerId_workId_with_underscores
      workId = parts.slice(2).join('_');
    }
    
    const work = catalog.getWork(workId);
    if (!work) return ctx.answerCbQuery('❌ Работа не найдена');

// 🌟 ПРОВЕРКА: Используем данные из БД, а не in-memory Map
const activeOrder = orders.findActiveOrder(customerUserId, workId);

// 🌟 Если заказ существует и у него уже есть исполнитель, блокируем повторное принятие
if (activeOrder && activeOrder.executorId) {
  return ctx.answerCbQuery('⚠️ Этот заказ уже принят другим исполнителем');
}

const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
let customerUsername = null;
try {
  const customerUser = await ctx.telegram.getChat(customerUserId);
  customerUsername = customerUser.username ? `@${customerUser.username}` : null;
} catch (e) {
  console.log('Не удалось получить username заказчика:', e.message);
}

const groupChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;

// 🌟 Получаем номер заказа из уже найденного activeOrder
const orderNumber = activeOrder ? activeOrder.orderNumber : '—';
    
// 🌟 Редактируем исходное сообщение в группе вместо отправки нового
if (activeOrder && activeOrder.managerMessageId && activeOrder.managerChatId) {
const executorUser = await ctx.telegram.getChat(executorUserId);
orders.updateOrder(activeOrder.id, {
executorId: executorUserId,
executorUsername: executorUser.username || null,
status: 'active',
acceptedAt: new Date().toLocaleString('ru-RU'),
chatId: chatId
});
const updatedOrder = orders.getOrder(activeOrder.id);
const updatedText = buildGroupOrderText(updatedOrder, 'in_progress');
try {
    // 🌟 Если сообщение — фото/документ (скриншот), используем editMessageCaption
    if (updatedOrder.screenshotFileId) {
        await ctx.telegram.editMessageCaption(
            activeOrder.managerChatId,
            activeOrder.managerMessageId,
            null,
            updatedText,
            { parse_mode: 'Markdown' }
        );
    } else {
        await ctx.telegram.editMessageText(
            activeOrder.managerChatId,
            activeOrder.managerMessageId,
            null,
            updatedText,
            { parse_mode: 'Markdown' }
        );
    }
} catch (e) {
    console.log('Не удалось обновить сообщение в группе:', e.message);
}
}
    
    activeChats.set(chatId, { chatId, customerUserId, executorUserId, workId, workTitle: work.title, orderId: activeOrder ? activeOrder.id : null, orderNumber: orderNumber, status: 'idle', createdAt: Date.now() });

    // 🌟 Используем УЖЕ ОБЪЯВЛЕННУЮ выше переменную activeOrder (без const!)
    if (activeOrder) {
      const executorUser = await ctx.telegram.getChat(executorUserId);
      orders.updateOrder(activeOrder.id, {
        executorId: executorUserId,
        executorUsername: executorUser.username || null,
        status: 'active',
        acceptedAt: new Date().toLocaleString('ru-RU')
      });
      activeChats.get(chatId).orderId = activeOrder.id;
    }

    const executorFullKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить заказчику', `er:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл/фото', `esf:${chatId}`)],
      [Markup.button.callback('❌ Завершить чат', `ecc:${chatId}`)],
      [Markup.button.callback('✅ Заказ выполнен', `oc:${chatId}`)]
    ]);

    await ctx.telegram.sendMessage(
      executorUserId, 
      `✅ *Вы приняли заказ!*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Работа:* ${work.title}\n👤 *Заказчик ID:* ${customerUserId}\n\nНапишите сообщение для заказчика или используйте кнопки ниже:`, 
      { parse_mode: 'Markdown', reply_markup: executorFullKeyboard.reply_markup }
    );

    await ctx.telegram.sendMessage(
      customerUserId, 
      `✅ *Ваш заказ в работе!*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Работа:* ${work.title}\n\nИсполнитель назначен. Теперь вы можете обсудить детали выполнения заказа, используя кнопки ниже:`, 
      { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, true) }
    );
    
    // 🌟 Логируем принятие заказа
    logger.logOrderEvent('accepted', {
      orderNumber: orderNumber,
      orderId: activeOrder ? activeOrder.id : null,
      workTitle: work.title,
      status: 'active',
      executorId: executorUserId,
      customerId: customerUserId
    }, executorUserId, ctx.from.username);

    await ctx.answerCbQuery('✅ Заказ принят');
  });

  bot.action(/^oc:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery();
    }
    chatData.status = 'completed';
    if (chatData.orderId) {
        orders.updateOrder(chatData.orderId, {
            status: 'completed',
            completedAt: new Date().toLocaleString('ru-RU')
        });
        
     const updatedOrder = orders.getOrder(chatData.orderId);
     if (updatedOrder && updatedOrder.managerMessageId && updatedOrder.managerChatId) {
         const completedText = buildGroupOrderText(updatedOrder, 'completed');
         try {
             // 🌟 Если сообщение — фото/документ (скриншот), используем editMessageCaption
             if (updatedOrder.screenshotFileId) {
                 await ctx.telegram.editMessageCaption(
                     updatedOrder.managerChatId,
                     updatedOrder.managerMessageId,
                     null,
                     completedText,
                     { parse_mode: 'Markdown' }
                 );
             } else {
                 await ctx.telegram.editMessageText(
                     updatedOrder.managerChatId,
                     updatedOrder.managerMessageId,
                     null,
                     completedText,
                     { parse_mode: 'Markdown' }
                 );
             }
         } catch (e) {
             console.log('Не удалось обновить сообщение в группе при завершении:', e.message);
         }
     }
    }

    await ctx.telegram.sendMessage(chatData.customerUserId, `✅ *Исполнитель завершил работу по заказу!*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}\n\nСпасибо за использование нашего сервиса! 🌊`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Заказ выполнен!*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    
    // 🌟 Логируем завершение заказа
    logger.logOrderEvent('completed', {
      orderNumber: chatData.orderNumber,
      orderId: chatData.orderId,
      workTitle: chatData.workTitle,
      status: 'completed',
      executorId: chatData.executorUserId,
      customerId: chatData.customerUserId
    }, ctx.from.id, ctx.from.username);
    
    await ctx.answerCbQuery('✅ Заказ отмечен как выполненный');
  });

  async function handleExecutorMessage(ctx, chatData) {
    const { customerUserId, workTitle, chatId, executorUserId } = chatData;
    // Логируем сообщение
    logger.logChatMessage(chatData, 'executor', ctx);
    const messageText = ctx.message.text || '[Фото/Файл]';

    // Отправляем заказчику текст + кнопки для ответа
    await ctx.telegram.sendMessage(
      customerUserId,
      `💬 *Вам сообщение от исполнителя*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${workTitle}\n\n${messageText}`,
      { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, true) }
    );

    // Пересылаем файл, если есть
    if (ctx.message.photo) {
      await ctx.telegram.sendPhoto(customerUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    } else if (ctx.message.document) {
      await ctx.telegram.sendDocument(customerUserId, ctx.message.document.file_id);
    }

    chatData.status = 'waiting_customer_action';

    // 🌟 Показываем ИСПОЛНИТЕЛЮ кнопки «написать ещё / отправить файл»
    await ctx.telegram.sendMessage(
      executorUserId,
      '✅ Сообщение отправлено заказчику.',
      { reply_markup: getChatKeyboard(chatId, false) }
    );
  }

  async function handleCustomerMessage(ctx, chatData) {
    const { executorUserId, workTitle, chatId, customerUserId } = chatData;
    // Логируем сообщение
    logger.logChatMessage(chatData, 'customer', ctx);
    const messageText = ctx.message.text || '[Фото/Файл]';

    // Отправляем исполнителю текст + кнопки для ответа
    await ctx.telegram.sendMessage(
      executorUserId,
      `💬 *Вам сообщение от заказчика*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${workTitle}\n\n${messageText}`,
      { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, false) }
    );

    // Пересылаем файл, если есть
    if (ctx.message.photo) {
      await ctx.telegram.sendPhoto(executorUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    } else if (ctx.message.document) {
      await ctx.telegram.sendDocument(executorUserId, ctx.message.document.file_id);
    }

    chatData.status = 'waiting_executor_message';

    // 🌟 Показываем ЗАКАЗЧИКУ кнопки «написать ещё / отправить файл»
    await ctx.telegram.sendMessage(
      customerUserId,
      '✅ Сообщение отправлено исполнителю.',
      { reply_markup: getChatKeyboard(chatId, true) }
    );
  }

  bot.action(/^cr:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId); // <--- попытка восстановления
    
    if (!chatData || chatData.customerUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery(); // закрываем "часики" на кнопке без ошибки
    }
    chatData.status = 'waiting_customer_message';
    await ctx.editMessageText(`✏️ *Напишите сообщение исполнителю:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
    await ctx.answerCbQuery();
  });

  bot.action(/^csf:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; 
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId); // <--- попытка восстановления

    if (!chatData || chatData.customerUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery(); // закрываем "часики" на кнопке без ошибки
    }
    chatData.status = 'waiting_customer_file';
    await ctx.editMessageText(`📎 *Пришлите файл или фото для исполнителя:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
    await ctx.answerCbQuery();
  });

  bot.action(/^ccc:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; 
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId); // <--- попытка восстановления

    if (!chatData || chatData.customerUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery(); // закрываем "часики" на кнопке без ошибки
    }
    chatData.status = 'closed';
    await ctx.telegram.sendMessage(chatData.executorUserId, `❌ *Заказчик завершил чат*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
  });

  bot.action(/^er:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery();
    }
    chatData.status = 'waiting_executor_message';
    await ctx.editMessageText(`✏️ *Напишите сообщение заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
    await ctx.answerCbQuery();
  });

  bot.action(/^erm:(.+)$/, async (ctx) => {
  const chatId = ctx.match[1]; 
  let chatData = activeChats.get(chatId);
  
  // 🌟 Упрощённая проверка: если чат существует
  if (!chatData) {
    chatData = restoreChatData(chatId);
  }
  if (!chatData) {
    return ctx.answerCbQuery('❌ Чат не найден или был завершён');
  }
  
  // Проверяем, что пользователь - исполнитель этого чата
  if (chatData.executorUserId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ У вас нет доступа к этому чату');
  }
  
  chatData.status = 'waiting_executor_message';
  await ctx.editMessageText(
    `✏️ *Напишите сообщение заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup }
  );
  await ctx.answerCbQuery();
});

bot.action(/^erf:(.+)$/, async (ctx) => {
  const chatId = ctx.match[1]; 
  let chatData = activeChats.get(chatId);
  
  if (!chatData) {
    chatData = restoreChatData(chatId);
  }
  if (!chatData) {
    return ctx.answerCbQuery('❌ Чат не найден или был завершён');  
  }
  
  if (chatData.executorUserId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ У вас нет доступа к этому чату');
  }
  
  chatData.status = 'waiting_executor_file';
  await ctx.editMessageText(
    `📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup }
  );
  await ctx.answerCbQuery();
  });

  bot.action(/^esf:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery();
    }
    chatData.status = 'waiting_executor_file';
    await ctx.editMessageText(`📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
    await ctx.answerCbQuery();
  });

  bot.action(/^ecc:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery();
    }
    chatData.status = 'closed';
    await ctx.telegram.sendMessage(chatData.customerUserId, `❌ *Исполнитель завершил чат по этому заказу.*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
  });

  // 🌟 Отмена режима ожидания сообщения/файла в чате заказчик-исполнитель
  bot.action(/^cancel_chat_mode:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    let chatData = activeChats.get(chatId);
    if (!chatData) chatData = restoreChatData(chatId);
    if (!chatData) {
      await ctx.reply('❌ Чат не найден.\n\nПопробуйте зайти в меню профиль и связаться с исполнителем через раздел История заказов');
      return ctx.answerCbQuery();
    }
    // Проверяем, что пользователь — участник этого чата
    if (chatData.customerUserId !== ctx.from.id && chatData.executorUserId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ У вас нет доступа к этому чату');
    } 
    // Сбрасываем статус чата в нейтральное состояние
    chatData.status = 'idle';

    // 🌟 Определяем, кто нажал кнопку — заказчик или исполнитель
    const isCustomer = chatData.customerUserId === ctx.from.id;
    const returnText = isCustomer 
        ? `💬 *Чат с исполнителем*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || '—'}\n📚 *Заказ:* ${chatData.workTitle}\n\nВыберите действие:`
        : `💬 *Чат с заказчиком*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || '—'}\n📚 *Заказ:* ${chatData.workTitle}\n\nВыберите действие:`;

    await ctx.editMessageText(returnText, { 
        parse_mode: 'Markdown', 
        reply_markup: getChatKeyboard(chatId, isCustomer) 
    });
    await ctx.answerCbQuery('Отменено');
  });

    // 🌟 Заказчик отвечает исполнителю (текст) — session-based
    bot.action(/^customer_reply_msg:(\d+)_(.+)$/, async (ctx) => {
    const executorId = ctx.match[1];
    const orderNumber = ctx.match[2];
    ctx.session = ctx.session || {};
    const order = orders.getOrderByNumber(orderNumber);
    ctx.session.customerReplyToExecutorId = executorId;
    ctx.session.customerReplyOrderNumber = orderNumber;
    ctx.session.customerReplyOrderTitle = order ? order.workTitle : 'Заказ';
    ctx.session.customerReplyOrderDate = order ? order.createdAt : '—';
    ctx.session.customerReplyOrderId = order ? order.id : null;
    ctx.session.customerReplyChatId = order ? `order_${ctx.from.id}_${order.workId}` : null;
    // 🌟 Сохраняем исходное сообщение для возможности возврата
    ctx.session.cancelReplyOriginalText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || null;
    ctx.session.cancelReplyOriginalKeyboard = ctx.callbackQuery.message.reply_markup || null;
    await ctx.editMessageText(
    `✏️ *Напишите ответ исполнителю:*\n\n📚 *Заказ:* ${ctx.session.customerReplyOrderTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
    );
    await ctx.answerCbQuery();
    });
 // 🌟 Заказчик отправляет файл исполнителю — session-based
    bot.action(/^customer_reply_file:(\d+)_(.+)$/, async (ctx) => {
    const executorId = ctx.match[1];
    const orderNumber = ctx.match[2];
    ctx.session = ctx.session || {};
    const order = orders.getOrderByNumber(orderNumber);
    ctx.session.customerReplyToExecutorId = executorId;
    ctx.session.customerReplyOrderNumber = orderNumber;
    ctx.session.customerReplyOrderTitle = order ? order.workTitle : 'Заказ';
    ctx.session.customerReplyOrderDate = order ? order.createdAt : '—';
    ctx.session.customerReplyOrderId = order ? order.id : null;
    ctx.session.customerReplyChatId = order ? `order_${ctx.from.id}_${order.workId}` : null;
    // 🌟 Сохраняем исходное сообщение для возможности возврата
    ctx.session.cancelReplyOriginalText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || null;
    ctx.session.cancelReplyOriginalKeyboard = ctx.callbackQuery.message.reply_markup || null;
    await ctx.editMessageText(
    `📎 *Пришлите файл или фото для исполнителя:*\n\n📚 *Заказ:* ${ctx.session.customerReplyOrderTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
    );
    await ctx.answerCbQuery();
    });

    // 🌟 Исполнитель отвечает заказчику (текст) — session-based
    bot.action(/^executor_reply_msg2:(\d+)_(.+)$/, async (ctx) => {
    const customerId = ctx.match[1];
    const orderNumber = ctx.match[2];
    ctx.session = ctx.session || {};
    const order = orders.getOrderByNumber(orderNumber);
    ctx.session.executorReplyToCustomerId = customerId;
    ctx.session.executorReplyOrderNumber = orderNumber;
    ctx.session.executorReplyOrderTitle = order ? order.workTitle : 'Заказ';
    ctx.session.executorReplyOrderDate = order ? order.createdAt : '—';
    ctx.session.executorReplyOrderId = order ? order.id : null;
    // 🌟 Сохраняем исходное сообщение для возможности возврата
    ctx.session.cancelReplyOriginalText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || null;
    ctx.session.cancelReplyOriginalKeyboard = ctx.callbackQuery.message.reply_markup || null;
    await ctx.editMessageText(
    `✏️ *Напишите сообщение заказчику:*\n\n📚 *Заказ:* ${ctx.session.executorReplyOrderTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
    );
    await ctx.answerCbQuery();
    });

    // 🌟 Исполнитель отправляет файл заказчику — session-based
    bot.action(/^executor_reply_file2:(\d+)_(.+)$/, async (ctx) => {
    const customerId = ctx.match[1];
    const orderNumber = ctx.match[2];
    ctx.session = ctx.session || {};
    const order = orders.getOrderByNumber(orderNumber);
    ctx.session.executorReplyToCustomerId = customerId;
    ctx.session.executorReplyOrderNumber = orderNumber;
    ctx.session.executorReplyOrderTitle = order ? order.workTitle : 'Заказ';
    ctx.session.executorReplyOrderDate = order ? order.createdAt : '—';
    ctx.session.executorReplyOrderId = order ? order.id : null;
    // 🌟 Сохраняем исходное сообщение для возможности возврата
    ctx.session.cancelReplyOriginalText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || null;
    ctx.session.cancelReplyOriginalKeyboard = ctx.callbackQuery.message.reply_markup || null;
    await ctx.editMessageText(
    `📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${ctx.session.executorReplyOrderTitle}`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
    );
    await ctx.answerCbQuery();
    });

    // 🌟 Заказчик нажимает "Ответить администратору"
    bot.action(/^admin_reply:(\d+)_(.+)_(\d+)$/, async (ctx) => {
      ctx.session = ctx.session || {}; // 🌟 Инициализируем сессию, если она не создана
      const customerId = parseInt(ctx.match[1]);
      const orderId = ctx.match[2];
      const adminId = parseInt(ctx.match[3]);
      // Получить информацию о заказе
      const order = ordersDb.getOrder(orderId);
      const orderNumber = order ? order.orderNumber : orderId;
      const orderTitle = order ? order.workTitle : 'Заказ';
      // 🌟 Используем ОТДЕЛЬНЫЕ переменные сессии для ответа заказчика админу
      ctx.session.customerReplyToAdminId = adminId;
      ctx.session.customerReplyToAdminOrderId = orderId;
      ctx.session.customerReplyToAdminOrderNumber = orderNumber;
      ctx.session.customerReplyToAdminOrderTitle = orderTitle;
      // 🌟 Сохраняем исходное сообщение для возможности возврата
      ctx.session.cancelReplyOriginalText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || null;
      ctx.session.cancelReplyOriginalKeyboard = ctx.callbackQuery.message.reply_markup || null;
      await ctx.editMessageText(
        `✏️ *Режим ответа администратору*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Заказ:* ${orderTitle}\n\nНапишите сообщение или прикрепите файл, которое будет отправлено администратору.`,
        { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
      );
      await ctx.answerCbQuery('✅ Готов к отправке ответа');
    });

    // 🌟 Отмена сессионных режимов ожидания (сообщение/файл)
    bot.action('cancel_session_reply', async (ctx) => {
      ctx.session = ctx.session || {};
      // Очищаем все возможные сессионные флаги ожидания
      ctx.session.customerReplyToExecutorId = null;
      ctx.session.customerReplyOrderNumber = null;
      ctx.session.customerReplyOrderTitle = null;
      ctx.session.customerReplyOrderDate = null;
      ctx.session.customerReplyOrderId = null;
      ctx.session.customerReplyChatId = null;
      ctx.session.executorReplyToCustomerId = null;
      ctx.session.executorReplyOrderNumber = null;
      ctx.session.executorReplyOrderTitle = null;
      ctx.session.executorReplyOrderDate = null;
      ctx.session.executorReplyOrderId = null;
      ctx.session.customerReplyToAdminId = null;
      ctx.session.customerReplyToAdminOrderId = null;
      ctx.session.customerReplyToAdminOrderNumber = null;
      ctx.session.customerReplyToAdminOrderTitle = null;
      
      // 🌟 Восстанавливаем исходное сообщение, если оно было сохранено
      if (ctx.session.cancelReplyOriginalText) {
          try {
              await ctx.editMessageText(ctx.session.cancelReplyOriginalText, { 
                  parse_mode: 'Markdown', 
                  reply_markup: ctx.session.cancelReplyOriginalKeyboard 
              });
          } catch (e) {
              await ctx.editMessageText('✅ Режим отменён.', { parse_mode: 'Markdown' });
          }
          ctx.session.cancelReplyOriginalText = null;
          ctx.session.cancelReplyOriginalKeyboard = null;
      } else {
          await ctx.editMessageText('✅ Режим отменён.', { parse_mode: 'Markdown' });
      }
      await ctx.answerCbQuery('Отменено');
    });

  function findExecutorChat(userId) {
    for (const chatData of activeChats.values()) {
      if (chatData.executorUserId === userId && (chatData.status === 'waiting_executor_message' || chatData.status === 'waiting_executor_file')) return chatData;
    }
    return null;
  }

  function findCustomerChat(userId) {
    for (const chatData of activeChats.values()) {
      if (chatData.customerUserId === userId && (chatData.status === 'waiting_customer_message' || chatData.status === 'waiting_customer_file')) return chatData;
    }
    return null;
  }
}

// 🌟 Функция ручного назначения исполнителя из админ-панели
async function assignExecutorToOrder(orderId, executorUserId, bot, isReassignment = false) {
  const order = ordersDb.getOrder(orderId);
  if (!order) throw new Error('Заказ не найден');
  if (order.executorId && !isReassignment) {
    throw new Error('У заказа уже есть исполнитель');
  }

  // 🌟 При переназначении удаляем старый чат из activeChats
  if (isReassignment && order.executorId) {
    for (const [chatId, chatData] of activeChats) {
      if (chatData.orderId === orderId) {
        activeChats.delete(chatId);
        break;
      }
    }
  }

  let executorUser;
  try {
    executorUser = await bot.telegram.getChat(executorUserId);
  } catch (e) {
    throw new Error('Исполнитель с таким ID не найден или заблокировал бота');
  }
  
  // Формируем уникальный chatId
  const chatId = `order_${order.customerId}_${order.workId || 'custom'}_${Date.now()}`;
  
  // Создаём запись в activeChats, чтобы работали кнопки переписки
  activeChats.set(chatId, {
    chatId,
    customerUserId: order.customerId,
    executorUserId: executorUserId,
    workId: order.workId || null,
    workTitle: order.workTitle,
    orderId: order.id,
    orderNumber: order.orderNumber || '—',
    status: 'idle',  // ← нейтральный статус
    createdAt: Date.now()
  });
  
  // Обновляем заказ в БД
    ordersDb.updateOrder(order.id, {
    executorId: executorUserId,
    executorUsername: executorUser.username || null,
    status: 'active',
    acceptedAt: new Date().toLocaleString('ru-RU'),
    chatId: chatId
  });
  
  // Клавиатура для исполнителя (с сокращёнными префиксами!)
  const executorFullKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Ответить заказчику', `er:${chatId}`)],
    [Markup.button.callback('📎 Отправить файл/фото', `esf:${chatId}`)],
    [Markup.button.callback('❌ Завершить чат', `ecc:${chatId}`)],
    [Markup.button.callback('✅ Заказ выполнен', `oc:${chatId}`)]
  ]);
  
  // Отправляем уведомление исполнителю
  await bot.telegram.sendMessage(
    executorUserId,
    `✅ *Вам назначен новый заказ!*\n\n🆔 *Номер заказа:* №${order.orderNumber || '—'}\n📚 *Работа:* ${order.workTitle}\n👤 *Заказчик ID:* ${order.customerId}\n\nНапишите сообщение для заказчика или используйте кнопки ниже:`,
    { parse_mode: 'Markdown', reply_markup: executorFullKeyboard.reply_markup }
  );
  
  // Отправляем уведомление заказчику
  const customerKeyboard = getChatKeyboard(chatId, true);
  const executorUsername = executorUser.username ? `@${executorUser.username}` : executorUser.first_name || 'Исполнитель';

  const customerText = isReassignment
    ? `👷 *По вашему заказу изменён исполнитель*\n\n🆔 *Номер заказа:* №${order.orderNumber || '—'}\n📚 *Работа:* ${order.workTitle}\n\nТеперь вы можете обсудить детали выполнения заказа:`
    : `✅ *Ваш заказ в работе!*\n\n🆔 *Номер заказа:* №${order.orderNumber || '—'}\n📚 *Работа:* ${order.workTitle}\n\nТеперь вы можете обсудить детали выполнения заказа:`;

  await bot.telegram.sendMessage(
    order.customerId,
    customerText,
    { parse_mode: 'Markdown', reply_markup: customerKeyboard }
  );
  
  return { chatId, executorUser, executorUsername };
}

// 🌟 Функция снятия исполнителя (при возврате в pending)
async function unassignExecutorFromOrder(orderId, bot) {
  const order = ordersDb.getOrder(orderId);
  if (!order || !order.executorId) return;
  
  // Удаляем из activeChats, чтобы старые кнопки не работали
  for (const [chatId, chatData] of activeChats) {
    if (chatData.orderId === orderId) {
      activeChats.delete(chatId);
      break;
    }
  }
  
  const oldExecutorId = order.executorId;
  
  // Обновляем заказ в БД
  ordersDb.updateOrder(order.id, {
    executorId: null,
    executorUsername: null,
    status: 'pending',
    acceptedAt: null
  });
  
  // Уведомляем исполнителя
  try {
    await bot.telegram.sendMessage(
      oldExecutorId,
      `⚠️ *Заказ отменён*\n\n🆔 *Номер заказа:* №${order.orderNumber || '—'}\n📚 *Работа:* ${order.workTitle}\n\nАдминистратор вернул заказ в статус ожидания. Вы больше не являетесь исполнителем.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.log('Не удалось уведомить исполнителя:', e.message);
  }
  
  // Уведомляем заказчика
  try {
    await bot.telegram.sendMessage(
      order.customerId,
      `⏳ *Статус заказа изменён*\n\n🆔 *Номер заказа:* №${order.orderNumber || '—'}\n📚 *Работа:* ${order.workTitle}\n\nВаш заказ временно возвращён в статус ожидания. Мы ищем нового исполнителя.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.log('Не удалось уведомить заказчика:', e.message);
  }
}

function findChatByOrderId(orderId) {
  // 1. Сначала ищем в оперативной памяти
  for (const [chatId, chatData] of activeChats) {
    if (chatData.orderId === orderId) return { chatId, chatData };
  }
  
  // 2. Если не нашли — пробуем восстановить чат из БД
  const order = orders.getOrder(orderId);
  if (order && order.executorId) {
    // Используем сохранённый chatId из БД, либо генерируем новый
    const genericChatId = order.chatId || `order_${order.customerId}_${order.workId || 'custom'}_${Date.now()}`;
    const chatData = restoreChatData(genericChatId);
    if (chatData) return { chatId: chatData.chatId, chatData };
  }
  
  return null;
}

module.exports = { 
  register, 
  findChatByOrderId, 
  assignExecutorToOrder, 
  unassignExecutorFromOrder,
  buildGroupOrderText
};