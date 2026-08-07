const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const orders = require('../data/orders');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');

const mediaBuffer = {};
const activeChats = new Map();

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
    ctx.session.order = { workId, step: 'waiting_details', details: { text: null, files: [] } };
    await ctx.editMessageText(`📎 Отлично!\n\n${work.prompt}`);
  });

  bot.on(['text', 'photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // 🌟 0. ПРОВЕРКА: Если пользователь в админ-панели — передаём управление admin.js
    if (ctx.session.adminState) {
      console.log('⚙️ Сообщение перехвачено админ-панелью, передаём управление admin.js');
      await next(); //  ВАЖНО: передаём управление следующему middleware
      return;
    }
    
    // 🌟 0.1 ПРОВЕРКА: Менеджер пишет ответ пользователю из поддержки
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
      console.log('✅ Ответ отправлен, режим ответа деактивирован');
      return;
    }

    // Теперь проверяем приватность чата
    if (ctx.chat?.type !== 'private' || ctx.from?.is_bot) return;
    
    const order = ctx.session.order;

    // 1. Исполнитель в активном чате
    const executorChat = findExecutorChat(ctx.from.id);
    if (executorChat && (executorChat.status === 'waiting_executor_message' || executorChat.status === 'waiting_executor_file')) {
      await handleExecutorMessage(ctx, executorChat);
      return;
    }

    // 2. Заказчик в активном чате
    const customerChat = findCustomerChat(ctx.from.id);
    if (customerChat && (customerChat.status === 'waiting_customer_message' || customerChat.status === 'waiting_customer_file')) {
      await handleCustomerMessage(ctx, customerChat);
      return;
    }

    // 3. Детали заказа
    if (order && order.step === 'waiting_details') {
      if (ctx.message.text) {
        order.details.text = ctx.message.text;
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
          await showConfirmation(ctx);
        }, 1000);
        return;
      }
      if (fileInfo.type === 'photo') fileInfo.fileName = `Фото ${order.details.files.length + 1}.jpg`;
      order.details.files.push(fileInfo);
      await showConfirmation(ctx);
      return;
    }

    // 4. Чек об оплате
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
          order.details.files.forEach(file => { updatedText += `• ${file.fileName}\n`; });
        }
        updatedText += `\n⏰ *Создан:* ${order.createdAt}\n✅ *Оплачен:* ${paidTime}\n🟢 *Статус:* ОПЛАЧЕН`;
        
        const chatId = `order_${ctx.from.id}_${order.workId}`;
        const executorKeyboard = createInlineKeyboard([[{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]]);
        
        await ctx.telegram.editMessageText(targetChatId, order.managerMessageId, null, updatedText, { 
          parse_mode: 'Markdown', reply_markup: executorKeyboard.reply_markup 
        });
        
        if (ctx.message.photo || ctx.message.document) {
          const fileToSend = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
          if (ctx.message.photo) await ctx.telegram.sendPhoto(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
          else await ctx.telegram.sendDocument(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
        }
        
        order.status = 'paid'; order.paidAt = paidTime; order.step = 'completed';
        loyalty.addToTotal(ctx.from.id, ctx.from.username, order.finalPrice);
        
        // 🌟 СОЗДАЁМ ЗАПИСЬ В БАЗЕ ЗАКАЗОВ
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
        
        // Сохраняем ID заказа в сессии, чтобы потом обновлять его
        ctx.session.currentOrderId = newOrder.id;

        const managerUrl = 'https://t.me/SmartDealsManager';
        const waitingKeyboard = Markup.inlineKeyboard([[Markup.button.url('👨‍💼 Связаться с менеджером', managerUrl)]]);
        
        await ctx.reply(
          `✅ *Заказ оформлен и ожидает назначения исполнителя.*\n\n📚 *Работа:* ${work.title}\n💰 *Сумма:* ${order.finalPrice} ₽\n\nМы уже ищем для вас лучшего специалиста. Если у вас есть срочные вопросы, нажмите кнопку ниже:`,
          { parse_mode: 'Markdown', reply_markup: waitingKeyboard.reply_markup }
        );
      } catch (error) {
        console.error('Ошибка обработки оплаты:', error);
        await ctx.reply('❌ Произошла ошибка. Напишите нам напрямую.');
      }
      return;
    }

    // 5. Случайное сообщение (поддержка)
    const supportChatId = process.env.SUPPORT_CHAT_ID || process.env.MY_CHAT_ID;
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
    
    try {
      const supportReplyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✏️ Ответить ${userLink}`, `support_reply:${ctx.from.id}`)]
      ]);

      await ctx.telegram.sendMessage(supportChatId, `📩 *Новое сообщение от пользователя*\n👤 ${userLink}\n\nСообщение переслано ниже 👇`, { 
        parse_mode: 'Markdown',
        reply_markup: supportReplyKeyboard.reply_markup
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
      order.details.files.forEach(file => { summary += `• ${file.fileName}\n`; });
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
    orderText += `👤 *Заказчик:* ${userLink}\n📚 *Работа:* ${work.title}\n`;
    orderText += `💰 *Сумма:* ${pricing.finalPrice} ₽ (скидка ${pricing.discountPercent}%)\n💳 *Оплата на:* \`${paymentDetails}\`\n`;
    if (order.details.text) orderText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
    if (order.details.files.length > 0) {
      orderText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
      order.details.files.forEach(file => { orderText += `• ${file.fileName}\n`; });
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
    const groupChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;

    await ctx.telegram.sendMessage(groupChatId, `✅ *Исполнитель ${executorName} (ID: \`${executorUserId}\`) принял заказ!*\n\n📚 *Работа:* ${work.title}\n👤 *Заказчик ID:* ${customerUserId}`, { parse_mode: 'Markdown' });
    
    activeChats.set(chatId, { chatId, customerUserId, executorUserId, workId, workTitle: work.title, status: 'waiting_executor_message', createdAt: Date.now() });

    // 🌟 ОБНОВЛЯЕМ ЗАКАЗ: назначаем исполнителя
    const activeOrder = orders.findActiveOrder(customerUserId, workId);
    if (activeOrder) {
      const executorUser = await ctx.telegram.getChat(executorUserId);
      orders.updateOrder(activeOrder.id, {
        executorId: executorUserId,
        executorUsername: executorUser.username || null,
        status: 'active',
        acceptedAt: new Date().toLocaleString('ru-RU')
      });
      // Сохраняем ID заказа в активных чатах для дальнейшего использования
      activeChats.get(chatId).orderId = activeOrder.id;
    }

    // 🌟 ЯВНО СОЗДАЁМ КЛАВИАТУРУ (без проблемных объединений)
    const executorFullKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить заказчику', `executor_reply:${chatId}`)],
      [Markup.button.callback('📎 Отправить файл/фото', `executor_send_file:${chatId}`)],
      [Markup.button.callback('❌ Завершить чат', `executor_close_chat:${chatId}`)],
      [Markup.button.callback('✅ Заказ выполнен', `order_completed:${chatId}`)]
    ]);

    await ctx.telegram.sendMessage(
      executorUserId, 
      `✅ *Вы приняли заказ!*\n\n📚 *Работа:* ${work.title}\n👤 *Заказчик ID:* ${customerUserId}\n\nНапишите сообщение для заказчика или используйте кнопки ниже:`, 
      { parse_mode: 'Markdown', reply_markup: executorFullKeyboard }
    );

    await ctx.telegram.sendMessage(
      customerUserId, 
      `✅ *Ваш заказ в работе!*\n\n📚 *Работа:* ${work.title}\n\nИсполнитель назначен. Теперь вы можете обсудить детали выполнения заказа, используя кнопки ниже:`, 
      { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, true) }
    );
    
    await ctx.answerCbQuery('✅ Заказ принят');
  });

  // 🌟 Обработчик кнопки "Заказ выполнен"
  bot.action(/^order_completed:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData || chatData.executorUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    
    chatData.status = 'completed';

    // 🌟 ОБНОВЛЯЕМ ЗАКАЗ: отмечаем как выполненный
    if (chatData.orderId) {
      orders.updateOrder(chatData.orderId, {
        status: 'completed',
        completedAt: new Date().toLocaleString('ru-RU')
      });
    }

    await ctx.telegram.sendMessage(chatData.customerUserId, `✅ *Исполнитель завершил работу по заказу!*\n\n📚 *Заказ:* ${chatData.workTitle}\n\nСпасибо за использование нашего сервиса! 🌊`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Заказ выполнен!*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('✅ Заказ отмечен как выполненный');
  });

  async function handleExecutorMessage(ctx, chatData) {
    const { customerUserId, workTitle, chatId, executorUserId } = chatData;
    const messageText = ctx.message.text || '[Фото/Файл]';
    await ctx.telegram.sendMessage(customerUserId, `💬 *Вам сообщение от исполнителя*\n\n📚 *Заказ:* ${workTitle}\n\n${messageText}`, { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, true) });
    if (ctx.message.photo) await ctx.telegram.sendPhoto(customerUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    else if (ctx.message.document) await ctx.telegram.sendDocument(customerUserId, ctx.message.document.file_id);
    chatData.status = 'waiting_customer_action';
    await ctx.telegram.sendMessage(executorUserId, '✅ Сообщение отправлено заказчику. Ожидайте ответа.', { reply_markup: getChatKeyboard(chatId, false) });
  }

  async function handleCustomerMessage(ctx, chatData) {
    const { executorUserId, workTitle, chatId, customerUserId } = chatData;
    const messageText = ctx.message.text || '[Фото/Файл]';
    await ctx.telegram.sendMessage(executorUserId, `💬 *Вам сообщение от заказчика*\n\n📚 *Заказ:* ${workTitle}\n\n${messageText}`, { parse_mode: 'Markdown', reply_markup: getChatKeyboard(chatId, false) });
    if (ctx.message.photo) await ctx.telegram.sendPhoto(executorUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    else if (ctx.message.document) await ctx.telegram.sendDocument(executorUserId, ctx.message.document.file_id);
    chatData.status = 'waiting_executor_message';
    await ctx.telegram.sendMessage(customerUserId, '✅ Сообщение отправлено исполнителю. Ожидайте ответа.', { reply_markup: getChatKeyboard(chatId, true) });
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
    await ctx.telegram.sendMessage(chatData.executorUserId, `❌ *Заказчик завершил чат*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
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
    await ctx.telegram.sendMessage(chatData.customerUserId, `❌ *Исполнитель завершил чат по этому заказу.*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
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

  // 🌟 Найти активный чат по ID заказа
  function findChatByOrderId(orderId) {
    for (const [chatId, chatData] of activeChats) {
      if (chatData.orderId === orderId) return { chatId, chatData };
    }
    return null;
  }
}

mmodule.exports = { register, findChatByOrderId };