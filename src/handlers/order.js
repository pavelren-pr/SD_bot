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
const { startComposer, handleComposerText, handleComposerFile } = require('../utils/messageComposer');

const mediaBuffer = {};

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

function register(bot) {
  bot.action(/^order:start:(.+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    if (work && work.isCustomOrder) { return; }
    // 🌟 Упрощённая очистка: только композер и текущий заказ
    ctx.session.messageComposer = null;
    ctx.session.customOrder = null;
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    
    let message = `📎 Отлично!\n\n${escapeHtml(work.prompt)}`;
    if (work.exampleUrl) {
      message += `\n\n📚 Пример работы и методические указания доступны по <a href="${escapeHtml(work.exampleUrl)}">ссылке</a>`;
    }
    await ctx.editMessageText(message, { parse_mode: 'HTML' });
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

    // 🌟 1. СНАЧАЛА проверяем композер сообщений (универсальный сборщик)
    if (ctx.session.messageComposer) {
      if (ctx.message.text) {
        const handled = await handleComposerText(ctx, next);
        if (handled) return;
      }
      if (ctx.message.photo || ctx.message.document) {
        const handled = await handleComposerFile(ctx, next);
        if (handled) return;
      }
    }

    // 🌟 2. Если пользователь в админ-панели — передаём управление admin.js
    if (ctx.session.adminState) {
      await next();
      return;
    }

    // 🌟 3. Если управляющий (Циклоп) в режиме ввода — передаём управление department.js
    if (ctx.session.deptState) {
      await next();
      return;
    }

    // 🌟 4. Работаем только в личных чатах и игнорируем ботов
    if (ctx.chat?.type !== 'private' || ctx.from?.is_bot) return;

    const order = ctx.session.order;

    // 🌟 5. Пропускаем индивидуальные заказы (обрабатываются в custom_order.js)
    if (ctx.session.customOrder) {
      return next();
    }

    // ==========================================
    // 📦 СБОР ДАННЫХ ОБЫЧНОГО ЗАКАЗА
    // ==========================================
    if (order && order.step === 'waiting_details') {
      const work = catalog.getWork(order.workId);
      const needsText = work.needs.includes('details') || work.needs.includes('variant');
      const needsFile = work.needs.includes('photo');

      // Приём текста
      if (ctx.message.text) {
        order.details.text = ctx.message.text;
        // Если нужен файл и его ещё нет — ждём файл
        if (needsFile && order.details.files.length === 0) {
          await ctx.reply('✅ Текст принят! Теперь прикрепите файл(ы) с заданием 📎');
          return;
        }
        await showConfirmation(ctx);
        return;
      }

      // Приём файлов
      let fileInfo = null;
      if (ctx.message.photo) {
        fileInfo = { type: 'photo', fileId: ctx.message.photo[ctx.message.photo.length - 1].file_id };
      } else if (ctx.message.document) {
        fileInfo = { type: 'document', fileId: ctx.message.document.file_id, fileName: ctx.message.document.file_name || 'Документ' };
      }
      if (!fileInfo) return;

      // Обработка медиагрупп (несколько фото сразу)
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
          if (needsText && !order.details.text) {
            await ctx.reply('✅ Файлы приняты! Теперь отправьте текстовые данные ✍️');
          } else {
            await showConfirmation(ctx);
          }
        }, 1000);
        return;
      }

      // Одиночный файл
      if (fileInfo.type === 'photo') fileInfo.fileName = `Фото ${order.details.files.length + 1}.jpg`;
      order.details.files.push(fileInfo);
      if (needsText && !order.details.text) {
        await ctx.reply('✅ Файл принят! Теперь отправьте текстовые данные ✍️');
        return;
      }
      await showConfirmation(ctx);
      return;
    }

    // ==========================================
    // 💳 ОБРАБОТКА ОПЛАТЫ (скриншот чека)
    // ==========================================
    if (order && order.step === 'awaiting_payment') {
      const work = catalog.getWork(order.workId);
      const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;

      // 🌟 Удаляем уведомление из чата поддержки (если было)
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

        // 🌟 ФИНАНСОВАЯ МОДЕЛЬ
        const basePrice = work.price;
        const commissionPercent = work.commission || 0;
        const executorPrice = Math.round(basePrice * (1 - commissionPercent / 100));
        const discountPercent = order.discountPercent || 0;
        const discountAmount = basePrice - (order.finalPrice || basePrice);
        const finalPrice = order.finalPrice || basePrice;

        const totalCommission = Math.round(basePrice * commissionPercent / 100);
        const actualCommission = Math.max(0, finalPrice - executorPrice);
        const commissionExpense = Math.max(0, totalCommission - actualCommission);

        const expenseConstantPercent = finance.getExpenseConstant();
        const expenseConstantBase = Math.round(totalCommission * expenseConstantPercent / 100);
        const expenseConstantAmount = expenseConstantBase - commissionExpense;

        const coOwners = finance.getCoOwners();
        const coOwnerShares = coOwners.map(co => ({
          id: co.id,
          username: co.username,
          percent: co.percent,
          amount: Math.round(totalCommission * co.percent / 100)
        }));

        // 🌟 Создаём заказ в БД
        const newOrder = orders.createOrder({
          workId: work.id,
          workTitle: work.title,
          subjectName: subject.name,
          courseName: course.name,
          customerId: ctx.from.id,
          customerUsername: ctx.from.username || null,
          basePrice: basePrice,
          executorPrice: executorPrice,
          finalPrice: finalPrice,
          discountPercent: discountPercent,
          discountAmount: discountAmount,
          commissionPercent: commissionPercent,
          commissionExpense: commissionExpense,
          expenseConstantPercent: expenseConstantPercent,
          expenseConstantAmount: expenseConstantAmount,
          coOwnerShares: coOwnerShares,
          price: finalPrice,
          commission: commissionPercent,
          createdAt: paidTime,
          managerChatId: targetChatId,
          detailsText: order.details.text || null,
          taskFiles: order.details.files || [],
          chatId: chatId
        });
        ctx.session.currentOrderId = newOrder.id;
        logger.logOrderEvent('created', newOrder, ctx.from.id, ctx.from.username);

        // 🌟 Отправляем сообщение в чат исполнителей
        const caption = buildExecutorOrderCaption(newOrder);
        const orderForKeyboard = {
          id: newOrder.id,
          orderNumber: newOrder.orderNumber,
          detailsText: order.details.text || null,
          taskFiles: order.details.files || []
        };
        const keyboard = buildExecutorOrderKeyboard(orderForKeyboard, chatId);

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
          sentMsg = await ctx.telegram.sendMessage(targetChatId, caption, {
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
          });
          orders.updateOrder(newOrder.id, { managerMessageId: sentMsg.message_id });
        }

        // 🌟 Сообщение заказчику с кнопкой менеджера
        const managerUsername = process.env.MANAGER_USERNAME || 'SmartDealsManager';
        const waitingKeyboard = Markup.inlineKeyboard([
          [Markup.button.url('👨‍💼 Связаться с менеджером', `https://t.me/${managerUsername}`)]
        ]);
        await ctx.reply(
          `✅ <b>Заказ оформлен и ожидает назначения исполнителя</b>.\n\n` +
          `🆔 <b>Номер заказа:</b> №${newOrder.orderNumber}\n\n` +
          `📚 <b>Работа:</b> ${escapeHtml(work.title)}\n` +
          `💰 <b>Сумма:</b> ${order.finalPrice} ₽\n\n` +
          `Мы уже ищем для вас лучшего специалиста.\n<i>Если у вас есть срочные вопросы, нажмите кнопку ниже:</i>`,
          { parse_mode: 'HTML', reply_markup: waitingKeyboard.reply_markup }
        );
      } catch (error) {
        console.error('Ошибка обработки оплаты:', error);
        logger.logError(error, ctx);
        await ctx.reply('❌ Произошла ошибка. Напишите нам напрямую.');
      }
      return;
    }

    // ==========================================
    // 📩 ПЕРЕСЫЛКА В ПОДДЕРЖКУ (все остальные сообщения)
    // ==========================================
    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;

    try {
      const supportReplyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✏️ Ответить ${userLink}`, `support_reply:${ctx.from.id}`)]
      ]);
      await ctx.telegram.sendMessage(supportChatId, `📩 <b>Новое сообщение от пользователя</b>\n👤 ${escapeHtml(userLink)}\n\nСообщение переслано ниже 👇`, {
        parse_mode: 'HTML',
        reply_markup: supportReplyKeyboard.reply_markup
      });
      await ctx.forwardMessage(supportChatId, ctx.chat.id, ctx.message.message_id);

      // 🌟 Временное уведомление вместо постоянного сообщения
      await sendTempNotification(ctx, '📩 Сообщение отправлено менеджеру');
    } catch (error) {
      console.error('Ошибка пересылки в поддержку:', error);
      logger.logError(error, ctx);
      await logger.notifyErrorToSupport(error, ctx, bot, {
        action: 'Пересылка сообщения в поддержку'
      });
      await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }
  });

  bot.action(/^support_reply:(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      
      startComposer(ctx, 'support_to_user', {
        targetUserId: parseInt(targetUserId),
        orderNumber: '—',
        orderTitle: 'Поддержка'
      });
      
      await ctx.editMessageText(
        `✏️ <b>Режим ответа</b>\n\nНапишите сообщение для пользователя (ID: <code>${targetUserId}</code>):`, 
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

    // 🌟 Ищем заказ в БД
    const activeOrder = orders.findActiveOrder(customerUserId, workId);

    // 🌟 Если заказ уже принят другим исполнителем — блокируем
    if (activeOrder && activeOrder.executorId) {
      return ctx.answerCbQuery('⚠️ Этот заказ уже принят другим исполнителем');
    }

    // Получаем номер заказа
    const orderNumber = activeOrder ? activeOrder.orderNumber : '—';
    const orderId = activeOrder ? activeOrder.id : null;

    // 🌟 Обновляем сообщение в группе исполнителей (статус "В РАБОТЕ")
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
      const inProgressKeyboard = buildInProgressKeyboard(updatedOrder);

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

    // 🌟 Формируем клавиатуру исполнителя (новая система — без старых чатов)
    const executorButtons = [];

    // Кнопки просмотра данных и файлов (если они есть)
    if (activeOrder && (activeOrder.detailsText || activeOrder.description)) {
      executorButtons.push([Markup.button.callback('📝 Исходные данные', `order_details_view:${orderId}`)]);
    }
    if (activeOrder && ((activeOrder.taskFiles && activeOrder.taskFiles.length > 0) || activeOrder.fileId)) {
      executorButtons.push([Markup.button.callback('📎 Файлы задания', `order_files_view:${orderId}:0`)]);
    }

    // 🌟 Кнопка композера для переписки с заказчиком
    executorButtons.push([Markup.button.callback('✏️ Написать заказчику', `mc_start:executor_to_customer:${orderNumber}:${customerUserId}`)]);

    // 🌟 Кнопка завершения заказа — теперь по orderId, а не chatId
    executorButtons.push([Markup.button.callback('✅ Заказ выполнен', `oc:${orderId}`)]);

    const executorFullKeyboard = Markup.inlineKeyboard(executorButtons);

    // 🌟 Уведомление исполнителю
    await ctx.telegram.sendMessage(
      executorUserId,
      `✅ <b>Вы приняли заказ!</b>\n\n` +
      `🆔 <b>Номер заказа:</b> №${escapeHtml(String(orderNumber))}\n` +
      `📚 <b>Работа:</b> ${escapeHtml(work.title)}\n` +
      `👤 <b>Заказчик ID:</b> ${customerUserId}`,
      { parse_mode: 'HTML', reply_markup: executorFullKeyboard.reply_markup }
    );

    // 🌟 Уведомление заказчику с кнопкой композера
    await ctx.telegram.sendMessage(
      customerUserId,
      `✅ <b>Ваш заказ в работе!</b>\n\n` +
      `🆔 <b>Номер заказа:</b> №${escapeHtml(String(orderNumber))}\n` +
      `📚 <b>Работа:</b> ${escapeHtml(work.title)}\n\n` +
      `Исполнитель назначен. Теперь вы можете обсудить детали выполнения заказа:`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Написать исполнителю', `mc_start:customer_to_executor:${orderNumber}:${executorUserId}`)]
        ]).reply_markup
      }
    );

    // 🌟 Логируем принятие заказа
    logger.logOrderEvent('accepted', {
      orderNumber: orderNumber,
      orderId: orderId,
      workTitle: work.title,
      status: 'active',
      executorId: executorUserId,
      customerId: customerUserId
    }, executorUserId, ctx.from.username);

    await ctx.answerCbQuery('✅ Заказ принят');
  });

  bot.action(/^oc:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = ordersDb.getOrder(orderId);
    if (!order || String(order.executorId) !== String(ctx.from.id)) {
      await ctx.reply('❌ Заказ не найден или у вас нет прав');
      return ctx.answerCbQuery();
    }
    if (order.status === 'completed') {
      await ctx.answerCbQuery('⚠️ Заказ уже отмечен как выполненный');
      return;
    }

    ordersDb.updateOrder(orderId, {
      status: 'completed',
      completedAt: new Date().toLocaleString('ru-RU')
    });

    const updatedOrder = ordersDb.getOrder(orderId);
    if (updatedOrder && updatedOrder.managerMessageId && updatedOrder.managerChatId) {
      const completedText = buildGroupOrderText(updatedOrder, 'completed');
      try {
        if (updatedOrder.screenshotFileId) {
          await ctx.telegram.editMessageCaption(updatedOrder.managerChatId, updatedOrder.managerMessageId, null, completedText, { parse_mode: 'HTML' });
        } else {
          await ctx.telegram.editMessageText(updatedOrder.managerChatId, updatedOrder.managerMessageId, null, completedText, { parse_mode: 'HTML' });
        }
      } catch (e) {
        console.log('Не удалось обновить сообщение в группе:', e.message);
      }
    }

    // Уведомление в поддержку
    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    if (supportChatId) {
      const executorPayout = order.executorPrice || Math.round((order.price || 0) * (1 - (order.commission || 0) / 100));
      const supportText = `✅ <b>Заказ выполнен!</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n👷 <b>Исполнитель:</b> ${escapeHtml(order.executorUsername) ? '@' + escapeHtml(order.executorUsername) : 'ID: ' + escapeHtml(order.executorId)}\n\n💰 <b>К выплате исполнителю:</b> ${executorPayout} ₽`;
      try {
        await ctx.telegram.sendMessage(supportChatId, supportText, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅ Оплачено', `support_paid:${orderId}`)]]).reply_markup
        });
      } catch (e) { console.log(e.message); }
    }

    await ctx.telegram.sendMessage(order.customerId, `✅ <b>Исполнитель завершил работу по заказу!</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Заказ:</b> ${escapeHtml(order.workTitle)}\n\nСпасибо за использование нашего сервиса! 🌊`, { parse_mode: 'HTML' });
    await ctx.editMessageText(`✅ <b>Заказ выполнен!</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(order.workTitle)}`, { parse_mode: 'HTML' });

    logger.logOrderEvent('completed', { orderNumber: order.orderNumber, orderId, workTitle: order.workTitle, status: 'completed', executorId: ctx.from.id, customerId: order.customerId }, ctx.from.id, ctx.from.username);
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

  // 🌟 Заказчик нажимает "Ответить администратору"
  bot.action(/^admin_reply:(\d+)_(.+)_(\d+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const customerId = parseInt(ctx.match[1]);
    const orderId = ctx.match[2];
    const adminId = parseInt(ctx.match[3]);
    
    const order = ordersDb.getOrder(orderId);
    const orderNumber = order ? order.orderNumber : orderId;
    const orderTitle = order ? order.workTitle : 'Заказ';
    
    startComposer(ctx, 'customer_to_admin', {
      targetUserId: adminId,
      orderId: orderId,
      orderNumber: orderNumber,
      orderTitle: orderTitle
    });
    
    await ctx.editMessageText(
      `✏️ <b>Режим ответа администратору</b>\n\n🆔 <b>Номер заказа:</b> №${escapeHtml(String(orderNumber))}\n📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n\nНапишите сообщение:`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('✅ Готов к отправке ответа');
  });

  // 🌟 Отмена сессионных режимов ожидания (сообщение/файл)
  bot.action('cancel_session_reply', async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.messageComposer = null;
    await ctx.editMessageText('✅ Режим отменён.', { parse_mode: 'HTML' });
    await ctx.answerCbQuery('Отменено');
  });
}

// 🌟 Функция ручного назначения исполнителя из админ-панели
async function assignExecutorToOrder(orderId, executorUserId, bot, isReassignment = false) {
  const order = ordersDb.getOrder(orderId);
  if (!order) throw new Error('Заказ не найден');
  if (order.executorId && !isReassignment) throw new Error('У заказа уже есть исполнитель');

  let executorUser;
  try { executorUser = await bot.telegram.getChat(executorUserId); }
  catch (e) { throw new Error('Исполнитель с таким ID не найден или заблокировал бота'); }

  const orderNumber = order.orderNumber || '—';

  ordersDb.updateOrder(order.id, {
    executorId: executorUserId,
    executorUsername: executorUser.username || null,
    status: 'active',
    acceptedAt: new Date().toLocaleString('ru-RU')
  });

  const assignButtons = [];
  if (order.detailsText || order.description) assignButtons.push([Markup.button.callback('📝 Исходные данные', `order_details_view:${order.id}`)]);
  if ((order.taskFiles && order.taskFiles.length > 0) || order.fileId) assignButtons.push([Markup.button.callback('📎 Файлы задания', `order_files_view:${order.id}:0`)]);
  assignButtons.push([Markup.button.callback('✏️ Написать заказчику', `mc_start:executor_to_customer:${orderNumber}:${order.customerId}`)]);
  assignButtons.push([Markup.button.callback('✅ Заказ выполнен', `oc:${order.id}`)]);

  await bot.telegram.sendMessage(executorUserId,
    `✅ <b>Вам назначен новый заказ!</b>\n\n🆔 <b>Номер заказа:</b> №${escapeHtml(orderNumber)}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n👤 <b>Заказчик ID:</b> ${order.customerId}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(assignButtons).reply_markup }
  );

  await bot.telegram.sendMessage(order.customerId,
    isReassignment
      ? `👷 <b>По вашему заказу изменён исполнитель</b>\n\n🆔 <b>Номер заказа:</b> №${escapeHtml(orderNumber)}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}`
      : `✅ <b>Ваш заказ в работе!</b>\n\n🆔 <b>Номер заказа:</b> №${escapeHtml(orderNumber)}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}`,
    { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✏️ Написать исполнителю', `mc_start:customer_to_executor:${orderNumber}:${executorUserId}`)]]) .reply_markup }
  );

  return { executorUser, executorUsername: executorUser.username };
}

// 🌟 Функция снятия исполнителя (при возврате в pending)
async function unassignExecutorFromOrder(orderId, bot) {
  const order = ordersDb.getOrder(orderId);
  if (!order || !order.executorId) return;

  const oldExecutorId = order.executorId;

  ordersDb.updateOrder(order.id, {
    executorId: null,
    executorUsername: null,
    status: 'pending',
    acceptedAt: null
  });

  try {
    await bot.telegram.sendMessage(
      oldExecutorId,
      `⚠️ <b>Заказ отменён</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n\nАдминистратор вернул заказ в статус ожидания. Вы больше не являетесь исполнителем.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('Не удалось уведомить исполнителя:', e.message);
  }

  try {
    await bot.telegram.sendMessage(
      order.customerId,
      `⏳ <b>Статус заказа изменён</b>\n\n🆔 <b>Номер заказа:</b> №${order.orderNumber || '—'}\n📚 <b>Работа:</b> ${escapeHtml(order.workTitle)}\n\nВаш заказ временно возвращён в статус ожидания. Мы ищем нового исполнителя.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('Не удалось уведомить заказчика:', e.message);
  }
}

// 🌟 Функция оставлена для совместимости, но возвращает null
function findChatByOrderId(orderId) {
  return null;
}

module.exports = { 
  register, 
  findChatByOrderId, 
  assignExecutorToOrder, 
  unassignExecutorFromOrder,
  buildGroupOrderText
};