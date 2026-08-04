const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const { createInlineKeyboard } = require('../utils/keyboard');

const mediaBuffer = {};
const activeChats = new Map();

function register(bot) {
  // ШАГ 1: Начало оформления
  bot.action(/^order:start:(.+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    
    ctx.session.order = { 
      workId, 
      step: 'waiting_details',
      details: { text: null, files: [] }
    };
    
    await ctx.editMessageText(`📎 Отлично!\n\n${work.prompt}`);
  });

  // ШАГ 2: Получение деталей
  bot.on(['text', 'photo', 'document'], async (ctx) => {
    if (ctx.chat?.type !== 'private' || ctx.from?.is_bot) return;
    
    ctx.session = ctx.session || {};
    const order = ctx.session.order;

    // Проверяем активные чаты
    const executorChat = findExecutorChat(ctx.from.id);
    if (executorChat && executorChat.status === 'waiting_executor_message') {
      await handleExecutorMessage(ctx, executorChat);
      return;
    }

    const customerChat = findCustomerChat(ctx.from.id);
    if (customerChat && customerChat.status === 'waiting_customer_message') {
      await handleCustomerMessage(ctx, customerChat);
      return;
    }

    // Сценарий А: Пользователь присылает детали ЗАКАЗА
    if (order && order.step === 'waiting_details') {
      if (ctx.message.text) {
        order.details.text = ctx.message.text;
        await showConfirmation(ctx);
        return;
      }
      
      let fileInfo = null;
      
      if (ctx.message.photo) {
        const largest = ctx.message.photo[ctx.message.photo.length - 1];
        fileInfo = { type: 'photo', fileId: largest.file_id };
      } else if (ctx.message.document) {
        fileInfo = { type: 'document', fileId: ctx.message.document.file_id, fileName: ctx.message.document.file_name || 'Документ' };
      }
      
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

    // Сценарий Б: Пользователь присылает чек об оплате
    if (order && order.step === 'awaiting_payment') {
      const work = catalog.getWork(order.workId);
      const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
      const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
      
      try {
        const now = new Date();
        const paidTime = now.toLocaleString('ru-RU');
        
        let updatedText = ' *НОВЫЙ ЗАКАЗ!*\n\n';
        updatedText += `👤 *Заказчик:* ${userLink}\n`;
        updatedText += `📚 *Работа:* ${work.title}\n`;
        updatedText += `💰 *Сумма:* ${order.finalPrice} ₽ (скидка ${order.discountPercent}%)\n`;
        updatedText += `💳 *Оплата на:* \`${order.paymentDetails}\`\n`;
        
        if (order.details.text) updatedText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
        if (order.details.files.length > 0) {
          updatedText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
          order.details.files.forEach(file => { updatedText += `• ${file.fileName}\n`; });
        }
        updatedText += `\n⏰ *Создан:* ${order.createdAt}\n`;
        updatedText += `✅ *Оплачен:* ${paidTime}\n`;
        updatedText += `\n🟢 *Статус:* ОПЛАЧЕН`;
        
        const chatId = `order_${ctx.from.id}_${order.workId}`;
        
        // Клавиатура для чата исполнителей
        const executorKeyboard = createInlineKeyboard([
          [{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]
        ]);
        
        await ctx.telegram.editMessageText(targetChatId, order.managerMessageId, null, updatedText, { 
          parse_mode: 'Markdown',
          reply_markup: executorKeyboard 
        });
        
        if (ctx.message.photo || ctx.message.document) {
          const fileToSend = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
          if (ctx.message.photo) {
            await ctx.telegram.sendPhoto(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
          } else {
            await ctx.telegram.sendDocument(targetChatId, fileToSend, { caption: '💳 Скриншот оплаты', reply_to_message_id: order.managerMessageId });
          }
        }
        
        order.status = 'paid';
        order.paidAt = paidTime;
        order.step = 'completed';
        loyalty.addToTotal(ctx.from.id, ctx.from.username, order.finalPrice);
        
        // Клавиатура для заказчика
        const customerKeyboard = createInlineKeyboard([
          [{ text: '💬 Связаться с исполнителем', callback: `contact_executor:${chatId}` }]
        ]);
        
        await ctx.reply(
          `✅ *Спасибо! Ваш заказ оплачен и принят в работу.*\n\n` +
          `📚 *Работа:* ${work.title}\n` +
          `💰 *Сумма:* ${order.finalPrice} ₽\n\n` +
          `Нажмите кнопку ниже, чтобы связаться с исполнителем:`,
          { 
            parse_mode: 'Markdown',
            reply_markup: customerKeyboard 
          }
        );
      } catch (error) {
        console.error('Ошибка обработки оплаты:', error);
        await ctx.reply('❌ Произошла ошибка. Напишите нам напрямую.');
      }
      return;
    }

    // Сценарий В: Случайное сообщение без активного заказа
    const managerChatId = process.env.MY_CHAT_ID;
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
    try {
      await ctx.telegram.sendMessage(managerChatId, `📸 *Пользователь прислал сообщение:*\n👤 ${userLink}`, { parse_mode: 'Markdown' });
      await ctx.forwardMessage(managerChatId, ctx.chat.id, ctx.message.message_id);
      await ctx.reply('✅ Спасибо! Менеджер получил ваше сообщение.');
    } catch (error) {
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

  // Функция показа подтверждения
  async function showConfirmation(ctx) {
    const order = ctx.session.order;
    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);

    let summary = ' *Подтверждение заказа*\n\n';
    summary += `📌 *Работа:* ${work.title}\n`;
    summary += `💵 *Базовая цена:* ${pricing.basePrice} ₽\n`;
    if (pricing.discountPercent > 0) summary += `🎉 *Ваша скидка:* -${pricing.discountPercent}%\n`;
    summary += `✅ *Итого к оплате:* ${pricing.finalPrice} ₽\n\n`;

    if (order.details.text) summary += ` *Ваши данные:*\n\`${order.details.text}\`\n\n`;
    if (order.details.files.length > 0) {
      summary += `📎 *Принято файлов:* ${order.details.files.length}\n`;
      order.details.files.forEach(file => { summary += `• ${file.fileName}\n`; });
      summary += '\n';
    }
    summary += 'Проверьте данные и нажмите кнопку ниже.';

    const buttons = [];
    buttons.push([{ text: '💳 Подтвердить и оплатить', callback: 'order:confirm' }]);
    if (order.details.text) buttons.push([{ text: '✏️ Изменить данные', callback: 'order:edit_text' }]);
    if (order.details.files.length > 0) buttons.push([{ text: '📎 Изменить вложение', callback: 'order:edit_files' }]);

    await ctx.reply(summary, { 
      parse_mode: 'Markdown',
      reply_markup: createInlineKeyboard(buttons)
    });
  }

  bot.action('order:edit_text', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery(' Заказ не найден');
    order.details.text = null;
    order.step = 'waiting_details';
    const work = catalog.getWork(order.workId);
    await ctx.editMessageText(`✏️ *Редактирование данных*\n\n${work.prompt}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action('order:edit_files', async (ctx) => {
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден');
    order.details.files = [];
    order.step = 'waiting_details';
    const work = catalog.getWork(order.workId);
    await ctx.editMessageText(`📎 *Загрузка вложений*\n\n${work.prompt}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  // ШАГ 3: Подтверждение и отправка менеджеру
  bot.action('order:confirm', async (ctx) => {
    ctx.session = ctx.session || {};
    const order = ctx.session.order;
    if (!order) return ctx.answerCbQuery('❌ Заказ не найден.');

    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);
    const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
    const paymentDetails = process.env[work.paymentEnv] || 'Не указан';
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
    const now = new Date();
    const createdAt = now.toLocaleString('ru-RU');

    let orderText = '🔔 *НОВЫЙ ЗАКАЗ!*\n\n';
    orderText += `👤 *Заказчик:* ${userLink}\n`;
    orderText += `📚 *Работа:* ${work.title}\n`;
    orderText += `💰 *Сумма:* ${pricing.finalPrice} ₽ (скидка ${pricing.discountPercent}%)\n`;
    orderText += `💳 *Оплата на:* \`${paymentDetails}\`\n`;
    
    if (order.details.text) orderText += `\n📝 *Данные от пользователя:*\n\`${order.details.text}\`\n`;
    if (order.details.files.length > 0) {
      orderText += `\n📎 *Файлы задания:* ${order.details.files.length}\n`;
      order.details.files.forEach(file => { orderText += `• ${file.fileName}\n`; });
    }
    orderText += `\n⏰ *Создан:* ${createdAt}\n`;
    orderText += `\n🟡 *Статус:* ОЖИДАЕТ ОПЛАТЫ`;

    const chatId = `order_${ctx.from.id}_${order.workId}`;
    const orderKeyboard = createInlineKeyboard([
      [{ text: '✅ Принять заказ', callback: `accept_order:${chatId}` }]
    ]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(targetChatId, orderText, { 
        parse_mode: 'Markdown',
        reply_markup: orderKeyboard
      });
      order.managerMessageId = sentMsg.message_id;
      
      for (const file of order.details.files) {
        if (file.type === 'photo') {
          await ctx.telegram.sendPhoto(targetChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
        } else if (file.type === 'document') {
          await ctx.telegram.sendDocument(targetChatId, file.fileId, { caption: `📎 ${file.fileName}`, reply_to_message_id: order.managerMessageId });
        }
      }
      
      order.createdAt = createdAt;
      order.finalPrice = pricing.finalPrice;
      order.discountPercent = pricing.discountPercent;
      order.paymentDetails = paymentDetails;
      order.step = 'awaiting_payment';
      
      await ctx.reply(
        `✅ *Заказ успешно оформлен!*\n\n` +
        `Для завершения переведите **${pricing.finalPrice} ₽** на карту/телефон:\n` +
        `\`${paymentDetails}\`\n\n` +
        `📸 *После оплаты просто пришлите скриншот чека в этот чат*, и менеджер сразу приступит к работе! `,
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCbQuery('✅ Заказ отправлен!');
    } catch (error) {
      console.error('Ошибка отправки заказа:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа.');
    }
  });

  // Связь с исполнителем
  bot.action(/^contact_executor:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData) return ctx.answerCbQuery('⏳ Исполнитель ещё не принял ваш заказ.');
    if (chatData.status === 'closed') return ctx.answerCbQuery('❌ Чат уже завершён.');

    const contactKeyboard = createInlineKeyboard([
      [{ text: '✏️ Написать сообщение', callback: `customer_reply:${chatId}` }],
      [{ text: '📎 Прислать файл', callback: `customer_send_file:${chatId}` }],
      [{ text: '❌ Завершить чат', callback: `customer_close_chat:${chatId}` }]
    ]);
    
    await ctx.reply(
      `💬 *Связь с исполнителем*\n\n📚 *Заказ:* ${chatData.workTitle}\n\nВыберите действие:`,
      { parse_mode: 'Markdown', reply_markup: contactKeyboard }
    );
    await ctx.answerCbQuery();
  });

  // Принять заказ
  bot.action(/^accept_order:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const executorUserId = ctx.from.id;
    const parts = chatId.split('_');
    const customerUserId = parseInt(parts[1]);
    const workId = parts.slice(2).join('_');
    const work = catalog.getWork(workId);
    if (!work) return ctx.answerCbQuery('❌ Работа не найдена');
    if (activeChats.has(chatId)) return ctx.answerCbQuery('⚠️ Этот заказ уже принят другим исполнителем');

    activeChats.set(chatId, {
      chatId, customerUserId, executorUserId, workId, workTitle: work.title,
      status: 'waiting_executor_message', createdAt: Date.now()
    });

    await ctx.reply(
      `✅ *Вы приняли заказ!*\n\n *Работа:* ${work.title}\n *Заказчик:* ID ${customerUserId}\n\nНапишите сообщение, которое хотите отправить заказчику:`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery('✅ Заказ принят');
  });

  async function handleExecutorMessage(ctx, chatData) {
    const { customerUserId, workTitle, chatId } = chatData;
    const customerKeyboard = createInlineKeyboard([
      [{ text: '✏️ Ответить исполнителю', callback: `customer_reply:${chatId}` }],
      [{ text: ' Прислать файл', callback: `customer_send_file:${chatId}` }],
      [{ text: '❌ Завершить чат', callback: `customer_close_chat:${chatId}` }]
    ]);
    
    await ctx.telegram.sendMessage(customerUserId,
      `💬 *Вам сообщение от исполнителя*\n\n📚 *Заказ:* ${workTitle}\n\n${ctx.message.text}`,
      { parse_mode: 'Markdown', reply_markup: customerKeyboard }
    );
    chatData.status = 'waiting_customer_action';
    await ctx.reply('✅ Сообщение отправлено заказчику. Ожидайте ответа.');
  }

  bot.action(/^customer_reply:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_customer_message';
    await ctx.editMessageText(`✏️ *Напишите сообщение исполнителю:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^customer_send_file:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'waiting_customer_file';
    await ctx.editMessageText(`📎 *Пришлите файл или фото:*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
  });

  bot.action(/^customer_close_chat:(.+)$/, async (ctx) => {
    const chatId = ctx.match[1];
    const chatData = activeChats.get(chatId);
    if (!chatData || chatData.customerUserId !== ctx.from.id) return ctx.answerCbQuery('❌ Чат не найден');
    chatData.status = 'closed';
    await ctx.telegram.sendMessage(chatData.executorUserId, `❌ *Заказчик завершил чат*\n\n *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.editMessageText(`✅ *Чат завершён*\n\n📚 *Заказ:* ${chatData.workTitle}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Чат завершён');
  });

  async function handleCustomerMessage(ctx, chatData) {
    const { executorUserId, workTitle } = chatData;
    let messageText = '';
    if (ctx.message.text) messageText = ctx.message.text;
    else if (ctx.message.photo) messageText = '[Фото]';
    else if (ctx.message.document) messageText = `[Файл: ${ctx.message.document.file_name || 'документ'}]`;

    await ctx.telegram.sendMessage(executorUserId,
      `💬 *Вам сообщение от заказчика*\n\n📚 *Заказ:* ${workTitle}\n\n${messageText}`,
      { parse_mode: 'Markdown' }
    );
    if (ctx.message.photo) await ctx.telegram.sendPhoto(executorUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id);
    else if (ctx.message.document) await ctx.telegram.sendDocument(executorUserId, ctx.message.document.file_id);

    chatData.status = 'waiting_executor_message';
    await ctx.reply('✅ Сообщение отправлено исполнителю.');
  }

  function findExecutorChat(userId) {
    for (const chatData of activeChats.values()) {
      if (chatData.executorUserId === userId && chatData.status === 'waiting_executor_message') return chatData;
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

module.exports = { register };