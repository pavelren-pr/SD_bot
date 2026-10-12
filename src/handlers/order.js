const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const orders = require('../data/orders');
const ordersDb = require('../data/orders');
const { createInlineKeyboard } = require('../utils/keyboard');
const logger = require('../utils/logger');
const storage = require('../utils/storage');
const finance = require('../data/finance');
const { Markup } = require('telegraf');
const { sendTempNotification } = require('../utils/notify');

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
      
      // 🌟 ИСПРАВЛЕННЫЙ ПАРСИНГ: двухэтапная проверка
      const fullWorkId = parts.slice(2).join('_');
      let workId;
      if (catalog.getWork(fullWorkId)) {
        workId = fullWorkId; // старый формат
      } else {
        workId = parts.slice(2, -1).join('_'); // новый формат с timestamp
      }

      const userOrders = orders.getUserOrders(customerUserId);
      const matchingOrders = userOrders.filter(o => o.workId === workId && o.executorId);
      if (matchingOrders.length > 0) {
        order = matchingOrders[matchingOrders.length - 1];
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

// 🌟 REFACTOR: переход на HTML — функция формирования текста сообщения в группе исполнителей
function buildGroupOrderText(order, status) {
    let header;
    if (status === 'new') header = '🔔 <b>НОВЫЙ ЗАКАЗ!</b>';
    else if (status === 'in_progress') header = '🔨 <b>ЗАКАЗ В РАБОТЕ</b>';
    else header = '✅ <b>ЗАКАЗ ВЫПОЛНЕН</b>';

    // 🌟 REFACTOR: переход на HTML — экранирование спецсимволов HTML вместо Markdown
    const esc = (s) => escapeHtml(s);
    
    // 🌟 Новая финансовая модель
    const basePrice = order.basePrice || order.price || 0;
    const executorPrice = order.executorPrice || Math.round((order.price || 0) * (1 - (order.commission || 0) / 100));
    const finalPrice = order.finalPrice || order.price || 0;
    const discountAmount = order.discountAmount || 0;
    const discountPercent = order.discountPercent || 0;
    const commissionExpense = order.commissionExpense || 0;
    const commissionPercent = order.commissionPercent || order.commission || 0;
    
    // 🌟 REFACTOR: переход на HTML — ссылка на пользователя в формате HTML
    const userLink = order.customerUsername 
        ? `@${escapeHtml(order.customerUsername)}` 
        : `<a href="tg://user?id=${order.customerId}">Пользователь</a>`;
    
    let text = `${header}\n\n`;
    text += `🆔 <b>Номер заказа:</b> №${order.orderNumber}\n`;
    text += `👤 <b>Заказчик:</b> ${userLink}\n`;
    text += `📚 <b>Работа:</b> ${esc(order.workTitle)}\n`;
    
    text += `💵 <b>Базовая цена:</b> ${basePrice} ₽\n`;
    if (discountPercent > 0) {
      text += `🎉 <b>Скидка заказчика:</b> ${discountPercent}% (-${discountAmount} ₽)\n`;
    }
    text += `💰 <b>Итог к оплате:</b> ${finalPrice} ₽\n`;
    text += `👷 <b>Исполнитель получит:</b> ${executorPrice} ₽ (комиссия ${commissionPercent}%)\n`;
    
    if (commissionExpense > 0) {
      text += `📉 <b>Покрытие из фонда комиссии:</b> ${commissionExpense} ₽\n`;
    }
    
    if (order.executorUsername || order.executorId) {
        // 🌟 REFACTOR: переход на HTML — экранируем username исполнителя
        const executorDisplay = order.executorUsername 
            ? `@${escapeHtml(order.executorUsername)}` 
            : `ID: ${order.executorId}`;
        text += `👷 <b>Исполнитель:</b> ${executorDisplay}\n`;
    }
    
    text += `\n⏰ <b>Создан:</b> ${order.createdAt}`;
    
    if (order.acceptedAt) {
        text += `\n🔨 <b>Принят:</b> ${order.acceptedAt}`;
    }
    if (order.completedAt) {
        text += `\n✅ <b>Выполнен:</b> ${order.completedAt}`;
    }
    
    // Статус
    if (status === 'new') text += `\n🟢 <b>Статус:</b> ОПЛАЧЕН — ОЖИДАЕТ ПРИНЯТИЯ`;
    else if (status === 'in_progress') text += `\n🟡 <b>Статус:</b> В РАБОТЕ`;
    else text += `\n🟢 <b>Статус:</b> ВЫПОЛНЕН`;
    
    return text;
}

// 🌟 REFACTOR: переход на HTML — подпись сообщения-скриншота в чате исполнителей
function buildExecutorOrderCaption(order) {
  const esc = (s) => escapeHtml(s);

  const basePrice = order.basePrice || order.price || 0;
  const executorPrice = order.executorPrice || Math.round((order.price || 0) * (1 - (order.commission || 0) / 100));
  const finalPrice = order.finalPrice || order.price || 0;
  const discountAmount = order.discountAmount || 0;
  const discountPercent = order.discountPercent || 0;
  const commissionExpense = order.commissionExpense || 0;
  const commissionPercent = order.commissionPercent || order.commission || 0;

  const userLink = order.customerUsername
    ? `@${escapeHtml(order.customerUsername)}`
    : `<a href="tg://user?id=${order.customerId}">Пользователь</a>`;

  let text = `🔔 <b>НОВЫЙ ЗАКАЗ!</b>\n\n`;
  text += `🆔 <b>Номер заказа:</b> №${order.orderNumber}\n`;
  text += `👤 <b>Заказчик:</b> ${userLink}\n`;
  text += `📚 <b>Работа:</b> ${esc(order.workTitle)}\n`;

  text += `💵 <b>Базовая цена:</b> ${basePrice} ₽\n`;
  if (discountPercent > 0) {
    text += `🎉 <b>Скидка заказчика:</b> ${discountPercent}% (-${discountAmount} ₽)\n`;
  }
  text += `💰 <b>Итог к оплате:</b> ${finalPrice} ₽\n`;
  text += `👷 <b>Исполнитель получит:</b> ${executorPrice} ₽ (комиссия ${commissionPercent}%)\n`;

  if (commissionExpense > 0) {
    text += `📉 <b>Покрытие из фонда комиссии:</b> ${commissionExpense} ₽\n`;
  }

  text += `⏰ <b>Создан:</b> ${order.createdAt}\n`;
  text += `🟢 <b>Статус:</b> ОПЛАЧЕН — ОЖИДАЕТ ПРИНЯТИЯ`;
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

// 🌟 Клавиатура для статуса "В РАБОТЕ" — БЕЗ кнопки "Принять заказ"
function buildInProgressKeyboard(order) {
  const buttons = [];
  if (order.detailsText || order.description) {
    buttons.push([Markup.button.callback('📝 Исходные данные', `order_data:${order.id}`)]);
  }
  if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) {
    buttons.push([Markup.button.callback('📎 Файлы задания', `order_files:${order.id}:0`)]);
  }
  return Markup.inlineKeyboard(buttons);
}

// 🌟 REFACTOR: переход на HTML — функция экранирования специальных символов HTML
// (вместо Markdown-экранирования: Telegram сам валидирует теги, экранируем только <, >, &)
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    
    // 🌟 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: очищаем все session-флаги, которые могут перехватить входящие сообщения
    ctx.session.adminReplyToCustomerId = null;
    ctx.session.adminReplyOrderId = null;
    ctx.session.adminReplyOrderNumber = null;
    ctx.session.adminReplyOrderTitle = null;
    ctx.session.adminReplyOrderDate = null;
    ctx.session.adminReplyAdminId = null;
    ctx.session.customerReplyToAdminId = null;
    ctx.session.customerReplyToAdminOrderId = null;
    ctx.session.customerReplyToAdminOrderNumber = null;
    ctx.session.customerReplyToAdminOrderTitle = null;
    ctx.session.executorReplyToCustomerId = null;
    ctx.session.executorReplyOrderId = null;
    ctx.session.executorReplyOrderTitle = null;
    ctx.session.executorReplyOrderDate = null;
    ctx.session.executorReplyOrderNumber = null;
    ctx.session.customerReplyToExecutorId = null;
    ctx.session.customerReplyOrderId = null;
    ctx.session.customerReplyOrderTitle = null;
    ctx.session.customerReplyOrderDate = null;
    ctx.session.customerReplyOrderNumber = null;
    ctx.session.customerReplyChatId = null;
    ctx.session.replyToUserId = null;
    ctx.session.replyToUsername = null;
    ctx.session.customOrder = null;
    ctx.session.waitingCustomPrice = null;
    ctx.session.waitingCustomMessageToCustomer = null;
    ctx.session.waitingCustomFileToCustomer = null;
    ctx.session.waitingCustomReplyToExecutor = null;
    ctx.session.waitingCustomReplyFileToExecutor = null;
    ctx.session.waitingCustomPayment = null;
    ctx.session.waitingCustomWriteToExecutor = null;
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    // 🌟 REFACTOR: переход на HTML — экранируем prompt и ссылку в формате HTML
    let message = `📎 Отлично!\n\n${escapeHtml(work.prompt)}`;
    // 🌟 Добавляем ссылку на примеры работ, если она есть в каталоге
    if (work.exampleUrl) {
      message += `\n\n📚 Пример работы и методические указания доступны по <a href="${escapeHtml(work.exampleUrl)}">ссылке</a>`;
    }
    await ctx.editMessageText(message, { parse_mode: 'HTML' }); // 🌟 REFACTOR: переход на HTML
  });

  // 🌟 Показать исходные данные (редактируем подпись)
  bot.action(/^order_data:(.+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    const backKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Подтверждение оплаты / Назад', `order_back:${order.id}`)]
    ]);
    const textToShow = order.detailsText || order.description || 'Нет данных';
    // 🌟 REFACTOR: переход на HTML — вместо Markdown-экранирования экранируем только <, >, &
    const dataCaption = `📝 <b>Исходные данные к заказу №${order.orderNumber}</b>\n\n${escapeHtml(textToShow)}`;

    try {
      await ctx.telegram.editMessageCaption(
        order.managerChatId, order.managerMessageId, null,
        dataCaption,
        { parse_mode: 'HTML', reply_markup: backKeyboard.reply_markup }
      );
      await ctx.answerCbQuery();
      } catch (e) {
        if (e.message && e.message.includes('message is not modified')) {
          // Ничего не меняем — сообщение уже показывает эти данные
          return ctx.answerCbQuery();
        }
        // Реальная ошибка (лимит подписи и т.д.) — отправляем отдельным сообщением
        await ctx.telegram.sendMessage(order.managerChatId, dataCaption, { parse_mode: 'HTML' });
        await ctx.answerCbQuery('Данные отправлены отдельным сообщением');
      }
  });

  // 🌟 Показать файлы задания (удаляем старое сообщение, отправляем файл с кнопками)
  bot.action(/^order_files:(.+):(\d+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    const fileIdx = parseInt(ctx.match[2]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    let files = order.taskFiles || [];
    if (files.length === 0 && order.fileId) {
      files = [{ type: order.fileType || 'document', fileId: order.fileId, fileName: order.fileName || 'Файл задания' }];
    }
    if (files.length === 0) return ctx.answerCbQuery('📭 Файлов нет');
    if (fileIdx >= files.length) return ctx.answerCbQuery('❌ Файл не найден');

    const file = files[fileIdx];

    // Навигация между файлами (показываем только если файлов больше одного)
    const keyboardRows = [];
    if (files.length > 1) {
      const navRow = [];
      navRow.push(fileIdx > 0 ? Markup.button.callback('◀️', `order_files:${order.id}:${fileIdx - 1}`) : Markup.button.callback('·', 'noop'));
      navRow.push(Markup.button.callback(`${fileIdx + 1}/${files.length}`, 'noop'));
      navRow.push(fileIdx < files.length - 1 ? Markup.button.callback('▶️', `order_files:${order.id}:${fileIdx + 1}`) : Markup.button.callback('·', 'noop'));
      keyboardRows.push(navRow);
    }
    keyboardRows.push([Markup.button.callback('💳 Подтверждение оплаты / Назад', `order_back:${order.id}`)]);

    const keyboard = Markup.inlineKeyboard(keyboardRows);
    const caption = `📎 Файл ${fileIdx + 1}/${files.length}: ${file.fileName || 'Файл задания'}`;

    try {
      // Удаляем старое сообщение
      try { await ctx.telegram.deleteMessage(order.managerChatId, order.managerMessageId); } catch (_) {}

      // Отправляем новое с файлом и кнопками
      let sentMsg;
      if (file.type === 'photo') {
        sentMsg = await ctx.telegram.sendPhoto(order.managerChatId, file.fileId, { caption, reply_markup: keyboard.reply_markup });
      } else {
        sentMsg = await ctx.telegram.sendDocument(order.managerChatId, file.fileId, { caption, reply_markup: keyboard.reply_markup });
      }

      // Обновляем ID сообщения в БД (он изменился!)
      orders.updateOrder(order.id, { managerMessageId: sentMsg.message_id });
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Не удалось показать файл:', e.message);
      await ctx.answerCbQuery('Не удалось показать файл');
    }
  });

  // 🌟 Показать исходные данные в личке — редактируем сообщение карточки
  bot.action(/^order_details_view:(.+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');

    const textToShow = order.detailsText || order.description || 'Нет данных';
    const header = `📝 <b>Исходные данные к заказу №${order.orderNumber}</b>\n\n`;
    const fullText = header + escapeHtml(textToShow);

    // Определяем роль для кнопки "Назад"
    const role = ctx.session.lastOrderViewRole || 'executor';

    // Если текст помещается в лимит — редактируем текущее сообщение
    if (fullText.length <= 4096) {
      const backKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад к заказу', `order_back_view:${order.id}:${role}`)]
      ]);

      try {
        await ctx.editMessageText(fullText, {
          parse_mode: 'HTML',
          reply_markup: backKeyboard.reply_markup
        });
        await ctx.answerCbQuery();
      } catch (e) {
        if (e.message && e.message.includes('message is not modified')) {
          return ctx.answerCbQuery();
        }
        // Если не удалось отредактировать — отправляем отдельно
        await ctx.reply(fullText, { parse_mode: 'HTML' });
        await ctx.answerCbQuery('Данные отправлены отдельным сообщением');
      }
    } else {
      // Текст слишком длинный — отправляем отдельными сообщениями
      await ctx.reply(header, { parse_mode: 'HTML' });
      const chunks = [];
      for (let i = 0; i < textToShow.length; i += 3500) {
        chunks.push(textToShow.substring(i, i + 3500));
      }
      for (const chunk of chunks) {
        await ctx.reply(escapeHtml(chunk), { parse_mode: 'HTML' });
      }
      await ctx.answerCbQuery('Данные отправлены отдельными сообщениями');
    }
  });

  // 🌟 Показать файлы задания в личке
  bot.action(/^order_files_view:(.+):(\d+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    const fileIdx = parseInt(ctx.match[2]);
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');

    let files = order.taskFiles || [];
    if (files.length === 0 && order.fileId) {
      files = [{ type: order.fileType || 'document', fileId: order.fileId, fileName: order.fileName || 'Файл задания' }];
    }
    if (files.length === 0) return ctx.answerCbQuery('📭 Файлов нет');
    if (fileIdx >= files.length) return ctx.answerCbQuery('❌ Файл не найден');

    const file = files[fileIdx];
    const role = ctx.session.lastOrderViewRole || 'executor';
    const caption = `📎 Файл ${fileIdx + 1}/${files.length}: ${file.fileName || 'Файл задания'} (Заказ №${order.orderNumber})`;

    // 🌟 Формируем клавиатуру с навигацией и кнопкой "Назад"
    const keyboardRows = [];
    if (files.length > 1) {
      const navRow = [];
      if (fileIdx > 0) navRow.push(Markup.button.callback('◀️ Пред.', `order_files_view:${order.id}:${fileIdx - 1}`));
      navRow.push(Markup.button.callback(`${fileIdx + 1}/${files.length}`, 'noop'));
      if (fileIdx < files.length - 1) navRow.push(Markup.button.callback('След. ▶️', `order_files_view:${order.id}:${fileIdx + 1}`));
      keyboardRows.push(navRow);
    }
    keyboardRows.push([Markup.button.callback('⬅️ Назад к заказу', `order_back_view:${order.id}:${role}`)]);
    const keyboard = Markup.inlineKeyboard(keyboardRows);

    try {
      // 🌟 Удаляем сообщение карточки заказа (используем явный chatId и messageId)
      try {
        await ctx.telegram.deleteMessage(
          ctx.callbackQuery.message.chat.id,
          ctx.callbackQuery.message.message_id
        );
      } catch (delErr) {
        console.log('Не удалось удалить сообщение карточки:', delErr.message);
      }

      // 🌟 Отправляем файл с кнопками
      if (file.type === 'photo') {
        await ctx.telegram.sendPhoto(ctx.from.id, file.fileId, {
          caption,
          reply_markup: keyboard.reply_markup
        });
      } else {
        await ctx.telegram.sendDocument(ctx.from.id, file.fileId, {
          caption,
          reply_markup: keyboard.reply_markup
        });
      }
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Не удалось отправить файл:', e.message);
      await ctx.answerCbQuery('❌ Не удалось отправить файл');
    }
  });

  // 🌟 Назад к карточке заказа (из просмотра данных/файлов)
  bot.action(/^order_back_view:(.+):(\w+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const role = ctx.match[2];
    const order = ordersDb.getOrder(orderId);
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');

    const { formatOrderCard } = require('./menu');
    const text = formatOrderCard(order, role);
    const buttons = [];

    // 🌟 Формируем кнопки в зависимости от роли — точно как в исходных обработчиках
    if (role === 'executor') {
      if (order.isCustomOrder) {
        if (order.status !== 'paid') {
          if (!order.price || order.price <= 0) {
            buttons.push([Markup.button.callback('💰 Назначить цену', `custom_set_price:${order.orderNumber}`)]);
          } else {
            buttons.push([Markup.button.callback('💰 Изменить цену', `custom_set_price:${order.orderNumber}`)]);
          }
        }
        buttons.push([Markup.button.callback('💬 Написать заказчику', `custom_write_customer:${order.orderNumber}`)]);
      } else {
        buttons.push([Markup.button.callback('💬 Написать заказчику', `orders:executor:contact:${orderId}`)]);
      }
      if (order.status !== 'completed') {
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `orders:executor:complete:${orderId}`)]);
      }
    } else if (role === 'admin') {
      buttons.push([Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)]);
      buttons.push([Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer:${orderId}`)]);
      if (!order.managerChatId) {
        buttons.push([Markup.button.callback('🏢 Привязать к чату', `admin:order_bind_chat:${orderId}`)]);
      }
      if (order.status !== 'completed') {
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
      }
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
    } else if (role === 'dept') {
      buttons.push([Markup.button.callback('💬 Написать заказчику', `dept:msg:${orderId}`)]);
      if (order.status !== 'completed') {
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `dept:status:${orderId}:completed`)]);
      }
    }

    // 🌟 Кнопки просмотра данных и файлов
    if (order.detailsText || order.description) {
      buttons.push([Markup.button.callback('📝 Исходные данные', `order_details_view:${orderId}`)]);
    }
    if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) {
      buttons.push([Markup.button.callback('📎 Файлы задания', `order_files_view:${orderId}:0`)]);
    }

    // 🌟 Кнопка "Назад" в список
    if (role === 'executor') {
      const EXEC_ACTIVE = ['active', 'paid', 'waiting_price', 'price_negotiating'];
      const backStatus = EXEC_ACTIVE.includes(order.status) ? 'active' : 'completed';
      buttons.push([Markup.button.callback('⬅️ Назад', `orders:executor:back:${backStatus}`)]);
    } else if (role === 'admin') {
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
    } else if (role === 'dept') {
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'dept:main')]);
    }

    const keyboard = Markup.inlineKeyboard(buttons);

    try {
      // Пробуем отредактировать текущее сообщение (если это текст после просмотра данных)
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
      });
      await ctx.answerCbQuery();
    } catch (e) {
      // Если не удалось отредактировать (например, текущее сообщение — файл),
      // удаляем его и отправляем новое
      try { await ctx.deleteMessage(); } catch (_) {}
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
      });
      await ctx.answerCbQuery();
    }
  });

  // 🌟 Назад — вернуть исходное состояние заказа (удалить старое, отправить новое)
  bot.action(/^order_back:(.+)$/, async (ctx) => {
    const order = ordersDb.getOrder(ctx.match[1]);
    if (!order || !order.managerMessageId) return ctx.answerCbQuery('❌ Заказ не найден');

    // Определяем текст и клавиатуру по статусу
    let caption;
    let keyboard;

    if (order.status === 'active') {
      caption = buildGroupOrderText(order, 'in_progress');
      const btns = [];
      if (order.detailsText || order.description) {
        btns.push([Markup.button.callback('📝 Исходные данные', `order_data:${order.id}`)]);
      }
      if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) {
        btns.push([Markup.button.callback('📎 Файлы задания', `order_files:${order.id}:0`)]);
      }
      keyboard = Markup.inlineKeyboard(btns);
    } else if (order.status === 'completed') {
      caption = buildGroupOrderText(order, 'completed');
      keyboard = Markup.inlineKeyboard([]);
    } else {
      caption = buildExecutorOrderCaption(order);
      keyboard = buildExecutorOrderKeyboard(order, order.chatId || `order_${order.customerId}_${order.workId}_${Date.now()}`);
    }

    try {
      // Удаляем старое сообщение
      try { await ctx.telegram.deleteMessage(order.managerChatId, order.managerMessageId); } catch (_) {}

      // Отправляем новое
      let sentMsg;
      if (order.screenshotFileId) {
        if (order.screenshotType === 'document') {
          sentMsg = await ctx.telegram.sendDocument(order.managerChatId, order.screenshotFileId, { caption, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        } else {
          sentMsg = await ctx.telegram.sendPhoto(order.managerChatId, order.screenshotFileId, { caption, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        }
      } else {
        sentMsg = await ctx.telegram.sendMessage(order.managerChatId, caption, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }

      orders.updateOrder(order.id, { managerMessageId: sentMsg.message_id });
      await ctx.answerCbQuery();
    } catch (e) {
      // Повтор без Markdown
      try {
        let sentMsg;
        if (order.screenshotFileId) {
          if (order.screenshotType === 'document') {
            sentMsg = await ctx.telegram.sendDocument(order.managerChatId, order.screenshotFileId, { caption, reply_markup: keyboard.reply_markup });
          } else {
            sentMsg = await ctx.telegram.sendPhoto(order.managerChatId, order.screenshotFileId, { caption, reply_markup: keyboard.reply_markup });
          }
        } else {
          sentMsg = await ctx.telegram.sendMessage(order.managerChatId, caption, { reply_markup: keyboard.reply_markup });
        }
        orders.updateOrder(order.id, { managerMessageId: sentMsg.message_id });
        await ctx.answerCbQuery();
      } catch (e2) {
        await ctx.answerCbQuery('Не удалось обновить сообщение');
      }
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

      const messageText = escapeHtml(rawMessageText);
      const safeOrderTitle = escapeHtml(orderTitle);

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
        `💬 <b>Вам сообщение от администратора</b>\n\n` +
        `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
        `📚 <b>Заказ:</b> ${safeOrderTitle}\n` +
        `📅 <b>Дата заказа:</b> ${orderDate}\n\n` +
        `${messageText}`,
        {
          parse_mode: 'HTML',
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

      await sendTempNotification(ctx, `✅ Сообщение отправлено заказчику (ID: ${targetUserId})`);

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
            `💬 <b>Ответ заказчика по заказу №${orderNumber}</b>\n\n👤 <b>Заказчик:</b> ${escapeHtml(customerUsername)}\n📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n\n${escapeHtml(messageText)}`,
            { parse_mode: 'HTML', reply_markup: replyKeyboard.reply_markup }
          );
          if (ctx.message.photo) {
            await ctx.telegram.sendPhoto(adminId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
          } else if (ctx.message.document) {
            await ctx.telegram.sendDocument(adminId, ctx.message.document.file_id);
          }
          await sendTempNotification(ctx, `✅ Ваш ответ отправлен администратору`);
        } catch (err) {
          await sendTempNotification(ctx, `❌ Не удалось отправить сообщение администратору: ${err.message}`);
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
        `💬 <b>Вам сообщение от исполнителя</b>\n\n🆔 <b>Номер заказа:</b> №${orderNumber}\n📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n📅 <b>Дата заказа:</b> ${orderDate}\n\n${escapeHtml(messageText)}`,
        { parse_mode: 'HTML', ...keyboard }
      );
      if (ctx.message.photo) {
        await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
      } else if (ctx.message.document) {
        await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
      }
      await sendTempNotification(ctx, `✅ Сообщение отправлено заказчику`);
      
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
    // 🌟 ИСПРАВЛЕННЫЙ ПАРСИНГ: двухэтапная проверка
    const parts = chatId.split('_');
    const fullWorkId = parts.slice(2).join('_');
    let workId;
    
    if (catalog.getWork(fullWorkId)) {
      workId = fullWorkId; // старый формат
    } else {
      workId = parts.slice(2, -1).join('_'); // новый формат с timestamp
    }
    
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
    `💬 <b>Вам сообщение от заказчика</b>\n\n🆔 <b>Номер заказа:</b> №${orderNumber}\n📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n📅 <b>Дата заказа:</b> ${orderDate}\n\n${escapeHtml(messageText)}`,
    { parse_mode: 'HTML', ...keyboard }
  );

  if (ctx.message.photo) {
    await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
  } else if (ctx.message.document) {
    await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
  }

  await sendTempNotification(ctx, `✅ Сообщение отправлено исполнителю`);

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
      
      await ctx.telegram.sendMessage(targetUserId, `💬 <b>Сообщение от менеджера:</b>\n\n${escapeHtml(messageText)}`, { parse_mode: 'HTML' });
      if (ctx.message.photo) await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
      else if (ctx.message.document) await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);
      
      await sendTempNotification(ctx, `✅ Ответ успешно отправлен пользователю @${escapeHtml(targetUsername)} (ID: ${targetUserId})`);
      ctx.session.replyToUserId = null;
      ctx.session.replyToUsername = null;
      return;
    }

    if (ctx.chat?.type !== 'private' || ctx.from?.is_bot) return;
    
    const order = ctx.session.order;

    if (ctx.session.customOrder) {
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
        await sendMessage(ctx, '✅ Текст принят! Теперь прикрепите файл(ы) с заданием 📎');
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
  const displayName = (ctx.from.first_name || 'Пользователь').replace(/[_*~`>#+-=|{}.!]/g, ''); const userLink = ctx.from.username ?`@${ctx.from.username}`:`[${displayName}](tg://user?id=${ctx.from.id})`;
  // 🌟 Удаляем уведомление из чата поддержки
  if (order.supportMessageId && order.supportChatId) {
    try {
      await ctx.telegram.deleteMessage(order.supportChatId, order.supportMessageId);
    } catch (e) {
      console.log('Не удалось удалить уведомление из поддержки:', e.message);
    }
  }
  try {
    const now = new Date();
      const paidTime = now.toLocaleString('ru-RU');
      order.status = 'paid'; order.paidAt = paidTime; order.step = 'completed';
      loyalty.addToTotal(ctx.from.id, ctx.from.username, order.finalPrice);

      const subject = catalog.getSubject(work.subjectId);
      const course = catalog.getCourse(subject.courseId);
      const chatId = ctx.session.order.chatId || `order_${ctx.from.id}_${order.workId}_${Date.now()}`;

      // 🌟 НОВАЯ ЛОГИКА: Фиксированная выплата исполнителю
      const basePrice = work.price; // Изначальная цена работы из каталога
      const commissionPercent = work.commission || 0;
      const executorPrice = Math.round(basePrice * (1 - commissionPercent / 100)); // Фикс на руки исполнителю
      
      const discountPercent = order.discountPercent || 0; // Скидка из loyalty
      const discountAmount = basePrice - (order.finalPrice || basePrice); // Сумма скидки
      const finalPrice = order.finalPrice || basePrice; // Что фактически заплатит заказчик
      
      // 🌟 РАСЧЁТ ПОКРЫТИЯ СКИДКИ И КОНСТАНТЫ
      const totalCommission = Math.round(basePrice * commissionPercent / 100);
      const actualCommission = Math.max(0, finalPrice - executorPrice); // Что платформа реально получила
      const commissionExpense = Math.max(0, totalCommission - actualCommission); // Потерянная комиссия из-за скидки

      // 🌟 ФИНАНСОВЫЙ СНИМОК (совладельцы и константа на момент заказа)
      const expenseConstantPercent = finance.getExpenseConstant();
      const expenseConstantBase = Math.round(totalCommission * expenseConstantPercent / 100);
      const expenseConstantAmount = expenseConstantBase - commissionExpense; // Может быть отрицательным!
      
      const coOwners = finance.getCoOwners();
      const coOwnerShares = coOwners.map(co => ({
        id: co.id,
        username: co.username,
        percent: co.percent,
        amount: Math.round(totalCommission * co.percent / 100)
      }));

      // 🌟 Сначала создаём заказ в БД, чтобы получить orderNumber
      const newOrder = orders.createOrder({
        workId: work.id,
        workTitle: work.title,
        subjectName: subject.name,
        courseName: course.name,
        customerId: ctx.from.id,
        customerUsername: ctx.from.username || null,
        // 🌟 НОВЫЕ ПОЛЯ
        basePrice: basePrice,
        executorPrice: executorPrice,
        finalPrice: finalPrice,
        discountPercent: discountPercent,
        discountAmount: discountAmount,
        commissionPercent: commissionPercent,
        commissionExpense: commissionExpense,
        // 🌟 ФИНАНСОВЫЙ СНИМОК
        expenseConstantPercent: expenseConstantPercent,
        expenseConstantAmount: expenseConstantAmount,
        coOwnerShares: coOwnerShares,
        // 📜 LEGACY ПОЛЯ (для совместимости)
        price: finalPrice,
        commission: commissionPercent,
        createdAt: paidTime,
        managerChatId: targetChatId,
        // 🌟 Сохраняем данные для кнопок
        detailsText: order.details.text || null,
        taskFiles: order.details.files || [],
        chatId: chatId
      });
      ctx.session.currentOrderId = newOrder.id;
      logger.logOrderEvent('created', newOrder, ctx.from.id, ctx.from.username);

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
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { screenshotFileId: screenshotPhoto, screenshotType: 'photo', managerMessageId: sentMsg.message_id });
      } else if (screenshotDoc) {
        sentMsg = await ctx.telegram.sendDocument(targetChatId, screenshotDoc, {
          caption: caption,
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { screenshotFileId: screenshotDoc, screenshotType: 'document', managerMessageId: sentMsg.message_id });
      } else {
        // Скриншота нет — отправляем обычное текстовое сообщение
        sentMsg = await ctx.telegram.sendMessage(targetChatId, caption, {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
        orders.updateOrder(newOrder.id, { managerMessageId: sentMsg.message_id });
      }

      // 🌟 Кнопка связи с менеджером
      const managerUsername = process.env.MANAGER_USERNAME || 'SmartDealsManager';
      const waitingKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('👨‍💼 Связаться с менеджером', `https://t.me/${managerUsername}`)]
      ]);
      await ctx.sendMessage(
        `✅ <b>Заказ оформлен и ожидает назначения исполнителя</b>.\n\n` +
        `🆔 <b>Номер заказа:</b> №${newOrder.orderNumber}\n\n` +
        `📚 <b>Работа:</b> ${work.title}\n` +
        `💰 <b>Сумма:</b> ${order.finalPrice} ₽\n\n` +
        `Мы уже ищем для вас лучшего специалиста.\n<i>Если у вас есть срочные вопросы, нажмите кнопку ниже:</i>`,
        { parse_mode: 'HTML', reply_markup: waitingKeyboard.reply_markup }
      );
    } catch (error) {
      console.error('Ошибка обработки оплаты:', error);
      logger.logError(error, ctx);
      await ctx.editMessageText('❌ Произошла ошибка. Напишите нам напрямую.');
    }
    return;
  }

    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
    
    try {
      const supportReplyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✏️ Ответить ${userLink}`, `support_reply:${ctx.from.id}`)]
      ]);

      await ctx.telegram.sendMessage(supportChatId, `📩 <b>Новое сообщение от пользователя</b>\n👤 ${userLink}\n\nСообщение переслано ниже 👇`, { 
        parse_mode: 'HTML', reply_markup: supportReplyKeyboard.reply_markup 
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
        `✏️ <b>Режим ответа</b>\n\nНапишите сообщение или прикрепите файл, которое будет отправлено пользователю @${username} (ID: <code>${targetUserId}</code>).\n\nЧтобы отменить, нажмите /start`, 
        { parse_mode: 'HTML' }
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
    
    let summary = '🛒 <b>Подтверждение заказа</b>\n\n';
    summary += `📌 <b>Работа:</b> ${escapeHtml(work.title)}\n`;
    summary += `💵 <b>Базовая цена:</b> ${pricing.basePrice} ₽\n`;
    if (pricing.discountPercent > 0) {
      summary += `🎉 <b>Ваша скидка:</b> -${pricing.discountPercent}%\n`;
    }
    summary += `✅ <b>Итого к оплате:</b> ${pricing.finalPrice} ₽\n\n`;
    
    // 🌟 ИСПРАВЛЕНО: экранируем текст пользователя и используем HTML-теги
    if (order.details.text) {
      summary += `📝 <b>Ваши данные:</b>\n<code>${escapeHtml(order.details.text)}</code>\n\n`;
    }
    
    if (order.details.files.length > 0) {
      summary += `📎 <b>Принято файлов:</b> ${order.details.files.length}\n`;
      order.details.files.forEach(file => { 
        summary += `• ${escapeHtml(file.fileName)}\n`; 
      });
      summary += '\n';
    }
    
    summary += 'Проверьте данные и нажмите кнопку ниже.';
    
    const buttons = [[{ text: '💳 Подтвердить и оплатить', callback: 'order:confirm' }]];
    if (order.details.text) {
      buttons.push([{ text: '✏️ Изменить данные', callback: 'order:edit_text' }]);
    }
    if (order.details.files.length > 0) {
      buttons.push([{ text: '📎 Изменить вложение', callback: 'order:edit_files' }]);
    }
    
    // 🌟 ИСПРАВЛЕНО: добавлена обработка ошибок
    try {
      await ctx.reply(summary, { 
        parse_mode: 'HTML', 
        reply_markup: createInlineKeyboard(buttons).reply_markup 
      });
    } catch (error) {
      console.error('Ошибка парсинга HTML в showConfirmation:', error.message);
      console.error('Проблемный текст:', summary);
      
      // Отправляем без форматирования как fallback
      try {
        const plainSummary = summary.replace(/<[^>]*>/g, ''); // удаляем HTML-теги
        await ctx.reply(plainSummary, { 
          reply_markup: createInlineKeyboard(buttons).reply_markup 
        });
      } catch (fallbackError) {
        console.error('Ошибка fallback:', fallbackError.message);
        await ctx.reply('⚠️ Произошла ошибка при формировании подтверждения. Попробуйте ещё раз или напишите в поддержку.');
      }
    }
  }

  bot.action('order:edit_text', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');
    order.details.text = null; order.step = 'waiting_details';
    await ctx.editMessageText(`✏️ <b>Редактирование данных</b>\n\n${catalog.getWork(order.workId).prompt}`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('order:edit_files', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');
    order.details.files = []; order.step = 'waiting_details';
    await ctx.editMessageText(`📎 <b>Загрузка вложений</b>\n\n${catalog.getWork(order.workId).prompt}`, { parse_mode: 'HTML' });
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

    let supportText = `🔔 <b>НОВЫЙ ЗАКАЗ (ожидает оплаты)</b>\n\n`;
    supportText += `🎓 <b>Курс:</b> ${course.name}\n`;
    supportText += `📖 <b>Предмет:</b> ${subject.name}\n`;
    supportText += `📚 <b>Работа:</b> ${work.title}\n`;
    supportText += `👤 <b>Заказчик:</b> ${userDisplay}\n`;
    supportText += `🆔 <b>ID:</b> <code>${ctx.from.id}</code>\n`;
    supportText += `💰 <b>Сумма:</b> ${pricing.finalPrice} ₽\n`;
    supportText += `⏰ <b>Создан:</b> ${createdAt}\n`;
    supportText += `🟡 <b>Статус:</b> ОЖИДАЕТ ОПЛАТЫ`;

    const supportButtons = [];
    if (ctx.from.username) {
      supportButtons.push([Markup.button.url('💬 Написать заказчику', `https://t.me/${ctx.from.username}`)]);
    }
    supportButtons.push([Markup.button.callback('✏️ Ответить заказчику', `support_reply:${ctx.from.id}`)]);

    try {
      const supportMsg = await ctx.telegram.sendMessage(supportChatId, supportText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(supportButtons).reply_markup
      });
      // 🌟 Сохраняем ID сообщения поддержки для удаления после оплаты
      order.supportMessageId = supportMsg.message_id;
      order.supportChatId = supportChatId;
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

    await ctx.editMessageText(
      `✅ <b>Заказ успешно оформлен!</b>\n\nДля завершения переведите <b>${pricing.finalPrice} ₽</b> на карту/телефон:\n<code>${paymentDetails}</code>\n\n📸 <b>После оплаты просто пришлите скриншот чека в этот чат</b>, и заказ поступит в работу! 🚀`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('✅ Заказ отправлен!');
  });

  bot.action(/^ao:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const executorUserId = ctx.from.id;
    const parts = chatId.split('_');
    const customerUserId = parseInt(parts[1]);
    
    // 🌟 ИСПРАВЛЕННЫЙ ПАРСИНГ: двухэтапная проверка
    // Сначала пробуем взять всё после второго элемента (старый формат без timestamp)
    const fullWorkId = parts.slice(2).join('_');
    let workId;
    
    if (catalog.getWork(fullWorkId)) {
      // Работа найдена — значит это старый формат (без timestamp)
      workId = fullWorkId;
    } else {
      // Работа не найдена — пробуем без последнего элемента (новый формат с timestamp)
      workId = parts.slice(2, -1).join('_');
    }
    
    const work = catalog.getWork(workId);
    if (!work) {
      console.error(`❌ Работа не найдена при парсинге chatId: ${chatId}`);
      console.error(`   Пробовали: "${fullWorkId}" и "${workId}"`);
      return ctx.answerCbQuery('❌ Работа не найдена');
    }

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

  const inProgressKeyboard = buildInProgressKeyboard(updatedOrder);   // 🌟 используем общую функцию

  try {
    if (updatedOrder.screenshotFileId) {
      await ctx.telegram.editMessageCaption(
        activeOrder.managerChatId,
        activeOrder.managerMessageId,
        null,
        updatedText,
        { parse_mode: 'HTML', reply_markup: inProgressKeyboard.reply_markup }
      );
    } else {
      await ctx.telegram.editMessageText(
        activeOrder.managerChatId,
        activeOrder.managerMessageId,
        null,
        updatedText,
        { parse_mode: 'HTML', reply_markup: inProgressKeyboard.reply_markup }
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

    // 🌟 Формируем клавиатуру с кнопками просмотра данных
    const executorButtons = [];
    
    // Кнопки просмотра исходных данных и файлов (если они есть)
    if (activeOrder && (activeOrder.detailsText || activeOrder.description)) {
      executorButtons.push([Markup.button.callback('📝 Исходные данные', `order_details_view:${activeOrder.id}`)]);
    }
    if (activeOrder && ((activeOrder.taskFiles && activeOrder.taskFiles.length > 0) || activeOrder.fileId)) {
      executorButtons.push([Markup.button.callback('📎 Файлы задания', `order_files_view:${activeOrder.id}:0`)]);
    }
    
    // Кнопки чата
    executorButtons.push([Markup.button.callback('✏️ Ответить заказчику', `er:${chatId}`)]);
    executorButtons.push([Markup.button.callback('📎 Отправить файл/фото', `esf:${chatId}`)]);
    executorButtons.push([Markup.button.callback('❌ Завершить чат', `ecc:${chatId}`)]);
    executorButtons.push([Markup.button.callback('✅ Заказ выполнен', `oc:${chatId}`)]);
    
    const executorFullKeyboard = Markup.inlineKeyboard(executorButtons);

    await ctx.telegram.sendMessage(
      executorUserId, 
      `✅ <b>Вы приняли заказ!</b>\n\n🆔 <b>Номер заказа:</b> №${orderNumber}\n📚 <b>Работа:</b> ${escapeHtml(work.title)}\n👤 <b>Заказчик ID:</b> ${customerUserId}`, 
      { parse_mode: 'HTML', reply_markup: executorFullKeyboard.reply_markup }
    );

    await ctx.telegram.sendMessage(
      customerUserId, 
      `✅ <b>Ваш заказ в работе!</b>\n\n🆔 <b>Номер заказа:</b> №${orderNumber}\n📚 <b>Работа:</b> ${escapeHtml(work.title)}\n\nИсполнитель назначен. Теперь вы можете обсудить детали выполнения заказа, используя кнопки ниже:`, 
      { parse_mode: 'HTML', reply_markup: getChatKeyboard(chatId, true) }
    );
    
    // 🌟 Логируем принятие заказа
    logger.logOrderEvent('accepted', {
      orderNumber: orderNumber,
      orderId: activeOrder ? activeOrder.id : null,
      workTitle: escapeHtml(work.title),
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
                     { parse_mode: 'HTML' }
                 );
             } else {
                 await ctx.telegram.editMessageText(
                     updatedOrder.managerChatId,
                     updatedOrder.managerMessageId,
                     null,
                     completedText,
                     { parse_mode: 'HTML' }
                 );
             }
         } catch (e) {
             console.log('Не удалось обновить сообщение в группе при завершении:', e.message);
         }
     }
    }

    // 🌟 Уведомление в чат поддержки о завершении заказа
    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const completedOrder = chatData.orderId ? orders.getOrder(chatData.orderId) : null;
    if (completedOrder && supportChatId) {
      const executorPayout = completedOrder.executorPrice || Math.round((completedOrder.price || 0) * (1 - (completedOrder.commission || 0) / 100));
      const supportText = `✅ <b>Заказ выполнен!</b>\n\n` +
        `🆔 <b>Номер заказа:</b> №${completedOrder.orderNumber}\n` +
        `📚 <b>Работа:</b> ${completedOrder.workTitle}\n` +
        `👷 <b>Исполнитель:</b> ${completedOrder.executorUsername ? '@' + completedOrder.executorUsername : 'ID: ' + completedOrder.executorId}\n\n` +
        `💰 <b>К выплате исполнителю:</b> ${executorPayout} ₽`;
      
      const paidKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Оплачено', `support_paid:${chatData.orderId}`)]
      ]);
      
      try {
        await ctx.telegram.sendMessage(supportChatId, supportText, {
          parse_mode: 'HTML',
          reply_markup: paidKeyboard.reply_markup
        });
      } catch (e) {
        console.log('Не удалось отправить уведомление в поддержку о завершении:', e.message);
      }
    }

    await ctx.telegram.sendMessage(chatData.customerUserId, `✅ <b>Исполнитель завершил работу по заказу!</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || "—"}\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}\n\nСпасибо за использование нашего сервиса! 🌊`, { parse_mode: 'HTML' });
    await ctx.editMessageText(`✅ <b>Заказ выполнен!</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML' });
    
    // 🌟 Логируем завершение заказа
    logger.logOrderEvent('completed', {
      orderNumber: chatData.orderNumber,
      orderId: chatData.orderId,
      workTitle: escapeHtml(chatData.workTitle),
      status: 'completed',
      executorId: chatData.executorUserId,
      customerId: chatData.customerUserId
    }, ctx.from.id, ctx.from.username);
    
    await ctx.answerCbQuery('✅ Заказ отмечен как выполненный');
  });

  // 🌟 Кнопка "Оплачено" — удаление уведомления из поддержки
  bot.action(/^support_paid:(.+)$/, async (ctx) => {
    try {
      await ctx.deleteMessage();
      await ctx.answerCbQuery('✅ Отмечено как оплачено');
    } catch (e) {
      console.log('Не удалось удалить сообщение поддержки:', e.message);
      await ctx.answerCbQuery('❌ Не удалось удалить сообщение');
    }
  });

  async function handleExecutorMessage(ctx, chatData) {
    const { customerUserId, workTitle, chatId, executorUserId } = chatData;
    // Логируем сообщение
    logger.logChatMessage(chatData, 'executor', ctx);
    const messageText = ctx.message.text || '[Фото/Файл]';

    // Отправляем заказчику текст + кнопки для ответа
    await ctx.telegram.sendMessage(
      customerUserId,
      `💬 <b>Вам сообщение от исполнителя</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || "—"}\n📚 <b>Заказ:</b> ${escapeHtml(workTitle)}\n\n${escapeHtml(messageText)}`,
      { parse_mode: 'HTML', reply_markup: getChatKeyboard(chatId, true) }
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
      `💬 <b>Вам сообщение от заказчика</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || "—"}\n📚 <b>Заказ:</b> ${escapeHtml(workTitle)}\n\n${escapeHtml(messageText)}`,
      { parse_mode: 'HTML', reply_markup: getChatKeyboard(chatId, false) }
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
    await ctx.editMessageText(`✏️ <b>Напишите сообщение исполнителю:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
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
    await ctx.editMessageText(`📎 <b>Пришлите файл или фото для исполнителя:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
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
    await ctx.telegram.sendMessage(chatData.executorUserId, `❌ <b>Заказчик завершил чат</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || "—"}\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML' });
    await ctx.editMessageText(`✅ <b>Чат завершён</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML' });
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
    await ctx.editMessageText(`✏️ <b>Напишите сообщение заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
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
    `✏️ <b>Напишите сообщение заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup }
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
    `📎 <b>Пришлите файл или фото заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup }
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
    await ctx.editMessageText(`📎 <b>Пришлите файл или фото заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', `cancel_chat_mode:${chatId}`)]]).reply_markup });
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
    await ctx.telegram.sendMessage(chatData.customerUserId, `❌ <b>Исполнитель завершил чат по этому заказу.</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || "—"}\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML' });
    await ctx.editMessageText(`✅ <b>Чат завершён</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}`, { parse_mode: 'HTML' });
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
        ? `💬 <b>Чат с исполнителем</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || '—'}\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}\n\nВыберите действие:`
        : `💬 <b>Чат с заказчиком</b>\n\n🆔 <b>Номер заказа:</b> №${chatData.orderNumber || '—'}\n📚 <b>Заказ:</b> ${escapeHtml(chatData.workTitle)}\n\nВыберите действие:`;

    await ctx.editMessageText(returnText, { 
        parse_mode: 'HTML', 
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
    `✏️ <b>Напишите ответ исполнителю:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(ctx.session.customerReplyOrderTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
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
    `📎 <b>Пришлите файл или фото для исполнителя:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(ctx.session.customerReplyOrderTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
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
    `✏️ <b>Напишите сообщение заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(ctx.session.executorReplyOrderTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
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
    `📎 <b>Пришлите файл или фото заказчику:</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(ctx.session.executorReplyOrderTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
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
        `✏️ <b>Режим ответа администратору</b>\n\n🆔 <b>Номер заказа:</b> №${orderNumber}\n📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n\nНапишите сообщение или прикрепите файл, которое будет отправлено администратору.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('↩️ Назад', 'cancel_session_reply')]]).reply_markup }
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
                  parse_mode: 'HTML', 
                  reply_markup: ctx.session.cancelReplyOriginalKeyboard 
              });
          } catch (e) {
              await ctx.editMessageText('✅ Режим отменён.', { parse_mode: 'HTML' });
          }
          ctx.session.cancelReplyOriginalText = null;
          ctx.session.cancelReplyOriginalKeyboard = null;
      } else {
          await ctx.editMessageText('✅ Режим отменён.', { parse_mode: 'HTML' });
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
  
  // 🌟 Формируем клавиатуру с кнопками просмотра данных
  const assignButtons = [];

  // Кнопки просмотра исходных данных и файлов (если они есть)
  if (order.detailsText || order.description) {
    assignButtons.push([Markup.button.callback('📝 Исходные данные', `order_details_view:${order.id}`)]);
  }
  if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) {
    assignButtons.push([Markup.button.callback('📎 Файлы задания', `order_files_view:${order.id}:0`)]);
  }

  // Кнопки чата
  assignButtons.push([Markup.button.callback('✏️ Ответить заказчику', `er:${chatId}`)]);
  assignButtons.push([Markup.button.callback('📎 Отправить файл/фото', `esf:${chatId}`)]);
  assignButtons.push([Markup.button.callback('❌ Завершить чат', `ecc:${chatId}`)]);
  assignButtons.push([Markup.button.callback('✅ Заказ выполнен', `oc:${chatId}`)]);

  const executorFullKeyboard = Markup.inlineKeyboard(assignButtons);

  // Отправляем уведомление исполнителю
  await bot.telegram.sendMessage(
    executorUserId,
    `✅ <b>Вам назначен новый заказ!</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n👤 <b>Заказчик ID:</b> ${order.customerId}\n\nНапишите сообщение для заказчика или используйте кнопки ниже:`,
    { parse_mode: 'HTML', reply_markup: executorFullKeyboard.reply_markup }
  );
  
  // Отправляем уведомление заказчику
  const customerKeyboard = getChatKeyboard(chatId, true);
  const executorUsername = executorUser.username ? `@${executorUser.username}` : executorUser.first_name || 'Исполнитель';

  const customerText = isReassignment
    ? `👷 <b>По вашему заказу изменён исполнитель</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n\nТеперь вы можете обсудить детали выполнения заказа:`
    : `✅ <b>Ваш заказ в работе!</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n\nТеперь вы можете обсудить детали выполнения заказа:`;

  await bot.telegram.sendMessage(
    order.customerId,
    customerText,
    { parse_mode: 'HTML', reply_markup: customerKeyboard }
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
      `⚠️ <b>Заказ отменён</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${order.workTitle}\n\nАдминистратор вернул заказ в статус ожидания. Вы больше не являетесь исполнителем.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('Не удалось уведомить исполнителя:', e.message);
  }
  
  // Уведомляем заказчика
  try {
    await bot.telegram.sendMessage(
      order.customerId,
      `⏳ <b>Статус заказа изменён</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${order.workTitle}\n\nВаш заказ временно возвращён в статус ожидания. Мы ищем нового исполнителя.`,
      { parse_mode: 'HTML' }
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