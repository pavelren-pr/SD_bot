const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const orders = require('../data/orders');
const ordersDb = require('../data/orders');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');

const mediaBuffer = {};
const activeChats = new Map();

// 🌟 Функция экранирования специальных символов Markdown
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function getChatKeyboard(chatId, isCustomer) {
  const replyText = isCustomer ? '✏️ Написать исполнителю' : '✏️ Ответить заказчику';
  const replyCallback = isCustomer ? `customer_reply:${chatId}` : `executor_reply:${chatId}`;
  const fileText = '📎 Отправить файл/фото';
  const fileCallback = isCustomer ? `customer_send_file:${chatId}` : `executor_send_file:${chatId}`;
  const closeText = '❌ Завершить чат';
  const closeCallback = isCustomer ? `customer_close_chat:${chatId}` : `executor_close_chat:${chatId}`;

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
    
    // Пропускаем если работа требует индивидуальной логики заказа
    if (work && work.isCustomOrder) {
      return; // Передаём управление обработчику custom_order.js
    }
    
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    await ctx.editMessageText(`📎 Отлично!\n\n${work.prompt}`);
  });

  bot.on(['text', 'photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    // 🌟 ПЕРВАЯ ПРОВЕРКА: Если пользователь в админ-панели — передаём управление admin.js
    if (ctx.session.adminState) {
      await next();
      return;
    }
    // 🌟 0.1 АДМИН ПИШЕТ ЗАКАЗЧИКУ
    if (ctx.session.adminReplyToCustomerId) {
      const targetUserId = ctx.session.adminReplyToCustomerId;
      const orderTitle = ctx.session.adminReplyOrderTitle;
      const orderDate = ctx.session.adminReplyOrderDate;
      const orderId = ctx.session.adminReplyOrderId;
      const messageText = ctx.message.text || '[Фото/Файл]';

      await ctx.telegram.sendMessage(
        targetUserId,
        `💬 *Вам сообщение от администратора*\n\n🆔 *Номер заказа:* №${orderId}\n📚 *Заказ:* ${orderTitle}\n📅 *Дата заказа:* ${orderDate}\n\n${messageText}`,
        { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✏️ Ответить администратору', `admin_reply:${targetUserId}_${orderId}`)]]) }
      );
      if (ctx.message.photo) await ctx.telegram.sendPhoto(targetUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
      else if (ctx.message.document) await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id);

      await ctx.reply(`✅ Сообщение отправлено заказчику (ID: ${targetUserId})`);
      ctx.session.adminReplyToCustomerId = null;
      ctx.session.adminReplyOrderId = null;
      ctx.session.adminReplyOrderTitle = null;
      ctx.session.adminReplyOrderDate = null;
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
      const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
      
      try {
        const now = new Date();
        const paidTime = now.toLocaleString('ru-RU');
        let updatedText = '🔔 *НОВЫЙ ЗАКАЗ!*\n\n';
        updatedText += `👤 *Заказчик:* ${userLink}\n📚 *Работа:* ${work.title}\n`;
        updatedText += `💰 *Сумма:* ${order.finalPrice} ₽ (скидка ${order.discountPercent}%)\n💳 *Оплата на:* \`${order.paymentDetails}\`\n`;
        if (order.details.text) updatedText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
        if (order.details.files.length > 0) {
          updatedText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
          order.details.files.forEach(file => { updatedText += `• ${escapeMarkdown(file.fileName)}\n`; });
        }
        updatedText += `\n⏰ *Создан:* ${order.createdAt}\n✅ *Оплачен:* ${paidTime}\n🟢 *Статус:* ОПЛАЧЕН`;
        
        const chatId = `order_${ctx.from.id}_${order.workId}`;
        const executorKeyboard = createInlineKeyboard([[{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]]);
        
        try {
          await ctx.telegram.editMessageText(targetChatId, order.managerMessageId, null, updatedText, { 
            parse_mode: 'Markdown', reply_markup: executorKeyboard.reply_markup 
          });
        } catch (e) {
          // 🌟 Обработка ошибки миграции группы в супергруппу при обновлении сообщения
          if (e.response && e.response.parameters && e.response.parameters.migrate_to_chat_id) {
            const newChatId = e.response.parameters.migrate_to_chat_id;
            console.log(`⚠️ Группа обновлена до супергруппы при обновлении сообщения. Новый chat_id: ${newChatId}`);
            try {
              await ctx.telegram.sendMessage(newChatId, updatedText, { 
                parse_mode: 'Markdown', reply_markup: executorKeyboard.reply_markup 
              });
              order.managerMessageId = null; // Сбрасываем ID, так как сообщение теперь в новом чате
            } catch (retryError) {
              console.log('Не удалось отправить сообщение в супергруппу:', retryError.message);
            }
          } else {
            console.log('Не удалось обновить сообщение менеджера:', e.message);
          }
        }
        
        if (ctx.message.photo || ctx.message.document) {
          const fileToSend = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
          if (ctx.message.photo) await ctx.telegram.sendPhoto(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
          else await ctx.telegram.sendDocument(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
        }
        
        order.status = 'paid'; order.paidAt = paidTime; order.step = 'completed';
        loyalty.addToTotal(ctx.from.id, ctx.from.username, order.finalPrice);
        
        const subject = catalog.getSubject(work.subjectId);
        const course = catalog.getCourse(subject.courseId);
        
        const newOrder = orders.createOrder({
          workId: work.id,
          workTitle: work.title,
          subjectName: subject.name,
          courseName: course.name,
          customerId: ctx.from.id,
          customerUsername: ctx.from.username || null,
          price: order.finalPrice,
          commission: work.commission,
          createdAt: paidTime
        });
        
        ctx.session.currentOrderId = newOrder.id;
        
        let updatedOrderText = '🔔 *НОВЫЙ ЗАКАЗ!*\n\n';
        updatedOrderText += `🆔 *Номер заказа:* №${newOrder.orderNumber}\n`;
        updatedOrderText += `👤 *Заказчик:* ${userLink}\n📚 *Работа:* ${work.title}\n`;
        updatedOrderText += `💰 *Сумма:* ${order.finalPrice} ₽ (скидка ${order.discountPercent}%)\n💳 *Оплата на:* \`${order.paymentDetails}\`\n`;
        if (order.details.text) updatedOrderText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
        if (order.details.files.length > 0) {
          updatedOrderText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
          order.details.files.forEach(file => { updatedOrderText += `• ${escapeMarkdown(file.fileName)}\n`; });
        }
        updatedOrderText += `\n⏰ *Создан:* ${order.createdAt}\n✅ *Оплачен:* ${paidTime}\n🟢 *Статус:* ОПЛАЧЕН`;
        
        try {
          await ctx.telegram.editMessageText(targetChatId, order.managerMessageId, null, updatedOrderText, { 
            parse_mode: 'Markdown', reply_markup: executorKeyboard.reply_markup 
          });
        } catch (e) {
          // 🌟 Обработка ошибки миграции группы в супергруппу при обновлении сообщения
          if (e.response && e.response.parameters && e.response.parameters.migrate_to_chat_id) {
            const newChatId = e.response.parameters.migrate_to_chat_id;
            console.log(`⚠️ Группа обновлена до супергруппы при обновлении сообщения. Новый chat_id: ${newChatId}`);
            try {
              await ctx.telegram.sendMessage(newChatId, updatedOrderText, { 
                parse_mode: 'Markdown', reply_markup: executorKeyboard.reply_markup 
              });
            } catch (retryError) {
              console.log('Не удалось отправить сообщение в супергруппу:', retryError.message);
            }
          } else {
            console.log('Не удалось обновить сообщение менеджера с номером:', e.message);
          }
        }
        
        const managerUrl = 'https://t.me/SmartDealsManager';
        const waitingKeyboard = Markup.inlineKeyboard([[Markup.button.url('👨‍💼 Связаться с менеджером', managerUrl)]]);
        
        await ctx.reply(
          `✅ *Заказ оформлен и ожидает назначения исполнителя.*\n\n🆔 *Номер заказа:* №${newOrder.orderNumber}\n\n📚 *Работа:* ${work.title}\n💰 *Сумма:* ${order.finalPrice} ₽\n\nМы уже ищем для вас лучшего специалиста. Если у вас есть срочные вопросы, нажмите кнопку ниже:`,
          { parse_mode: 'Markdown', reply_markup: waitingKeyboard.reply_markup }
        );
      } catch (error) {
        console.error('Ошибка обработки оплаты:', error);
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
    const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
    const paymentDetails = process.env[work.paymentEnv] || 'Не указан';
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
    const createdAt = new Date().toLocaleString('ru-RU');

    let orderText = '🔔 *НОВЫЙ ЗАКАЗ!*\n\n';
    orderText += `🆔 *Номер заказа:* будет присвоен после оплаты\n`;
    orderText += `👤 *Заказчик:* ${userLink}\n📚 *Работа:* ${work.title}\n`;
    orderText += `💰 *Сумма:* ${pricing.finalPrice} ₽ (скидка ${pricing.discountPercent}%)\n💳 *Оплата на:* \`${paymentDetails}\`\n`;
    if (order.details.text) orderText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
    if (order.details.files.length > 0) {
      orderText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
      order.details.files.forEach(file => { orderText += `• ${escapeMarkdown(file.fileName)}\n`; });
    }
    orderText += `\n⏰ *Создан:* ${createdAt}\n🟡 *Статус:* ОЖИДАЕТ ОПЛАТЫ`;

    const chatId = `order_${ctx.from.id}_${order.workId}`;
    try {
      const sentMsg = await ctx.telegram.sendMessage(targetChatId, orderText, { 
        parse_mode: 'Markdown', reply_markup: createInlineKeyboard([[{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]]).reply_markup 
      });
      order.managerMessageId = sentMsg.message_id;
      for (const file of order.details.files) {
        if (file.type === 'photo') await ctx.telegram.sendPhoto(targetChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
        else if (file.type === 'document') await ctx.telegram.sendDocument(targetChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
      }
      order.createdAt = createdAt; order.finalPrice = pricing.finalPrice; order.discountPercent = pricing.discountPercent; order.paymentDetails = paymentDetails; order.step = 'awaiting_payment';
      await ctx.reply(`✅ *Заказ успешно оформлен!*\n\nДля завершения переведите **${pricing.finalPrice} ₽** на карту/телефон:\n\`${paymentDetails}\`\n\n📸 *После оплаты просто пришлите скриншот чека в этот чат*, и менеджер сразу приступит к работе! 🚀`, { parse_mode: 'Markdown' });
      await ctx.answerCbQuery('✅ Заказ отправлен!');
    } catch (error) {
      // 🌟 Обработка ошибки миграции группы в супергруппу
      if (error.response && error.response.parameters && error.response.parameters.migrate_to_chat_id) {
        const newChatId = error.response.parameters.migrate_to_chat_id;
        console.log(`⚠️ Группа обновлена до супергруппы. Новый chat_id: ${newChatId}`);
        
        // Сохраняем новый chat_id для будущей работы (можно добавить в .env или базу данных)
        // Временно используем новый chat_id для повторной отправки
        try {
          const sentMsg = await ctx.telegram.sendMessage(newChatId, orderText, { 
            parse_mode: 'Markdown', reply_markup: createInlineKeyboard([[{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]]).reply_markup 
          });
          order.managerMessageId = sentMsg.message_id;
          for (const file of order.details.files) {
            if (file.type === 'photo') await ctx.telegram.sendPhoto(newChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
            else if (file.type === 'document') await ctx.telegram.sendDocument(newChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
          }
          order.createdAt = createdAt; order.finalPrice = pricing.finalPrice; order.discountPercent = pricing.discountPercent; order.paymentDetails = paymentDetails; order.step = 'awaiting_payment';
          await ctx.reply(`✅ *Заказ успешно оформлен!*\\n\\nДля завершения переведите **${pricing.finalPrice} ₽** на карту/телефон:\\n\`${paymentDetails}\`\\n\\n📸 *После оплаты просто пришлите скриншот чека в этот чат*, и менеджер сразу приступит к работе! 🚀`, { parse_mode: 'Markdown' });
          await ctx.answerCbQuery('✅ Заказ отправлен!');
          return;
        } catch (retryError) {
          console.error('Ошибка отправки заказа в супергруппу:', retryError);
        }
      }
      console.error('Ошибка отправки заказа:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа.');
    }
  });

  bot.action(/^accept_order:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const executorUserId = ctx.from.id;
    const parts = chatId.split('_');
    const customerUserId = parseInt(parts[1]);
    const workId = parts.slice(2).join('_');
    const work = catalog.getWork(workId);
    
    if (!work) return ctx.answerCbQuery('❌ Работа не найдена');
    if (activeChats.has(chatId)) return ctx.answerCbQuery('⚠️ Этот заказ уже принят другим исполнителем');

    const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    let customerUsername = null;
    try {
      const customerUser = await ctx.telegram.getChat(customerUserId);
      customerUsername = customerUser.username ? `@${customerUser.username}` : null;
    } catch (e) {
      console.log('Не удалось получить username заказчика:', e.message);
    }
    
    const groupChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
    
    // 🌟 Получаем номер заказа (один раз!)
    const activeOrder = orders.findActiveOrder(customerUserId, workId);
    const orderNumber = activeOrder ? activeOrder.orderNumber : '—';
    
    await ctx.telegram.sendMessage(
      groupChatId, 
      `✅ *Исполнитель ${executorName} принял заказ!*\n\n🆔 *Номер заказа:* №${orderNumber}\n📚 *Работа:* ${work.title}\n👤 *Заказчик:* ${customerUsername || `ID: ${customerUserId}`}`, 
      { parse_mode: 'Markdown' }
    );
    
    activeChats.set(chatId, { chatId, customerUserId, executorUserId, workId, workTitle: work.title, orderId: activeOrder ? activeOrder.id : null, orderNumber: orderNumber, status: 'waiting_executor_message', createdAt: Date.now() });

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
      [Markup.button.callback('✏️ Ответить заказчику', `executor_reply:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл/фото', `executor_send_file:${chatId}`)],
      [Markup.button.callback('❌ Завершить чат', `executor_close_chat:${chatId}`)],
      [Markup.button.callback('✅ Заказ выполнен', `order_completed:${chatId}`)]
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
    
    await ctx.answerCbQuery('✅ Заказ принят');
  });

  bot.action(/^order_completed:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    
    chatData.status = 'completed';
    if (chatData.orderId) {
      orders.updateOrder(chatData.orderId, {
        status: 'completed',
        completedAt: new Date().toLocaleString('ru-RU')
      });
    }

    await ctx.telegram.sendMessage(chatData.customerUserId, `✅ *Исполнитель завершил работу по заказу!*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}\n\nСпасибо за использование нашего сервиса! 🌊`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Заказ выполнен!*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('✅ Заказ отмечен как выполненный');
  });

  async function handleExecutorMessage(ctx, chatData) {
    const { customerUserId, workTitle, chatId, executorUserId } = chatData;
    const messageText = ctx.message.text || '[Фото/Файл]';
    await ctx.telegram.sendMessage(customerUserId, `💬 *Вам сообщение от исполнителя*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${workTitle}\n\n${messageText}`, { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, true) });
    if (ctx.message.photo) await ctx.telegram.sendPhoto(customerUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    else if (ctx.message.document) await ctx.telegram.sendDocument(customerUserId, ctx.message.document.file_id);
    chatData.status = 'waiting_customer_action';
    await ctx.telegram.sendMessage(executorUserId, '✅ Сообщение отправлено заказчику. Ожидайте ответа.', { reply_markup: getChatKeyboard(chatId, false) });
  }

  async function handleCustomerMessage(ctx, chatData) {
    const { executorUserId, workTitle, chatId, customerUserId } = chatData;
    const messageText = ctx.message.text || '[Фото/Файл]';
    
    // 🌟 Создаём клавиатуру отдельно
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💬 Написать сообщение заказчику', `executor_reply_msg:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл заказчику', `executor_reply_file:${chatId}`)]
    ]);
    
    await ctx.telegram.sendMessage(
      executorUserId, 
      `💬 *Вам сообщение от заказчика*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${workTitle}\n\n${messageText}`, 
      { parse_mode: 'Markdown', ...keyboard } // 🌟 Распаковка вместо reply_markup
    );
    
    if (ctx.message.photo) {
      await ctx.telegram.sendPhoto(executorUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    } else if (ctx.message.document) {
      await ctx.telegram.sendDocument(executorUserId, ctx.message.document.file_id);
    }
    
    chatData.status = 'waiting_executor_message';
    await ctx.telegram.sendMessage(
      customerUserId, 
      '✅ Сообщение отправлено исполнителю. Ожидайте ответа.', 
      { reply_markup: getChatKeyboard(chatId, true).reply_markup } // 🌟 Если getChatKeyboard возвращает объект
    );
}

  bot.action(/^customer_reply:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_customer_message';
    await ctx.editMessageText(`✏️ *Напишите сообщение исполнителю:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^customer_send_file:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_customer_file';
    await ctx.editMessageText(`📎 *Пришлите файл или фото для исполнителя:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^customer_close_chat:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'closed';
    await ctx.telegram.sendMessage(chatData.executorUserId, `❌ *Заказчик завершил чат*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
  });

  bot.action(/^executor_reply:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_executor_message';
    await ctx.editMessageText(`✏️ *Напишите сообщение заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^executor_reply_msg:(.+)$/, async (ctx) => {
  const chatId = ctx.match[1]; 
  const chatData = activeChats.get(chatId);
  
  // 🌟 Упрощённая проверка: если чат существует
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
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
});

bot.action(/^executor_reply_file:(.+)$/, async (ctx) => {
  const chatId = ctx.match[1]; 
  const chatData = activeChats.get(chatId);
  
  if (!chatData) {
    return ctx.answerCbQuery('❌ Чат не найден или был завершён');
  }
  
  if (chatData.executorUserId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ У вас нет доступа к этому чату');
  }
  
  chatData.status = 'waiting_executor_file';
  await ctx.editMessageText(
    `📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
});


  bot.action(/^executor_send_file:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_executor_file';
    await ctx.editMessageText(`📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^executor_close_chat:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1]; const chatData = activeChats.get(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'closed';
    await ctx.telegram.sendMessage(chatData.customerUserId, `❌ *Исполнитель завершил чат по этому заказу.*\n\n🆔 *Номер заказа:* №${chatData.orderNumber || "—"}\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
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
    await ctx.editMessageText(
    `✏️ *Напишите ответ исполнителю:*\n\n📚 *Заказ:* ${ctx.session.customerReplyOrderTitle}`,
    { parse_mode: 'Markdown' }
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
    await ctx.editMessageText(
    `📎 *Пришлите файл или фото для исполнителя:*\n\n📚 *Заказ:* ${ctx.session.customerReplyOrderTitle}`,
    { parse_mode: 'Markdown' }
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
    await ctx.editMessageText(
    `✏️ *Напишите сообщение заказчику:*\n\n📚 *Заказ:* ${ctx.session.executorReplyOrderTitle}`,
    { parse_mode: 'Markdown' }
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
    await ctx.editMessageText(
    `📎 *Пришлите файл или фото заказчику:*\n\n📚 *Заказ:* ${ctx.session.executorReplyOrderTitle}`,
    { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
    });

  bot.action(/^admin_reply:(\d+)_(.+)$/, async (ctx) => {
    const parts = ctx.match[0].split(':');
    const data = parts[1]; // "userId_orderId"
    const underscoreIndex = data.lastIndexOf('_');
    const targetUserId = data.substring(0, underscoreIndex);
    const orderId = data.substring(underscoreIndex + 1);
    
    // Получить информацию о заказе
    const order = require('../data/orders').getOrder(orderId);
    const orderNumber = order ? order.orderNumber : orderId;
    const orderTitle = order ? order.workTitle : 'Заказ';
    
    ctx.session.adminReplyToCustomerId = targetUserId;
    ctx.session.adminReplyOrderId = orderId;
    ctx.session.adminReplyOrderTitle = orderTitle;
    ctx.session.adminReplyOrderDate = order ? order.createdAt : new Date().toLocaleString('ru-RU');
    
    await ctx.editMessageText(`✏️ *Режим ответа заказчику*\n\n🆔 *Номер заказа:* №${orderNumber}\n👤 *Заказчик ID:* ${targetUserId}\n\nНапишите сообщение или прикрепите файл, которое будет отправлено заказчику.`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('✅ Готов к отправке ответа');
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

  function findChatByOrderId(orderId) {
    for (const [chatId, chatData] of activeChats) {
      if (chatData.orderId === orderId) return { chatId, chatData };
    }
    return null;
  }

module.exports = { register, findChatByOrderId };