const catalog = require('../data/catalog');
const orders = require('../data/orders');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');

// Хранилище состояний для индивидуальных заказов
const customOrderStates = new Map();

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Получает конфигурацию чата и оплаты для работы
 * @param {Object} work - объект работы из каталога
 * @returns {Object} - { chatEnvVar, paymentEnvVar, chatId, paymentValue }
 */
function getWorkConfig(work) {
  const chatEnvVar = work.chatEnv || 'DEFAULT_CHAT_ID';
  const paymentEnvVar = work.paymentEnv || 'DEFAULT_CARD_NUMBER';
  
  const chatId = process.env[chatEnvVar];
  const paymentValue = process.env[paymentEnvVar];
  
  return { chatEnvVar, paymentEnvVar, chatId, paymentValue };
}

/**
 * Формирует название предмета с курсом
 */
function getSubjectFullName(work) {
  const subject = catalog.getSubject(work.subjectId);
  const course = catalog.getCourse(subject.courseId);
  return { subjectName: subject.name, courseName: course.name };
}

function register(bot) {
  // Обработка кнопки "Отправить задание" для индивидуальных заказов
  bot.action(/^order:start:(.+)$/, async (ctx, next) => {
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    
    // Пропускаем если работа не требует индивидуальной логики заказа
    if (!work || !work.isCustomOrder) {
      return next(); // Передаём управление стандартному обработчику
    }
    
    const { subjectName, courseName } = getSubjectFullName(work);
    
    ctx.session = ctx.session || {};
    ctx.session.customOrder = { 
      workId, 
      step: 'waiting_description', 
      description: null, 
      file: null 
    };
    
    const promptText = work.prompt || 
      `Пожалуйста, отправьте текстовое описание вашего задания:\n` +
      `• Сроки исполнения\n` +
      `• Дополнительная информация\n` +
      `• Другие важные детали\n\n` +
      `💡 *Подсказка:* После отправки текста вы сможете прикрепить файл с заданием.`;
    
    await ctx.editMessageText(
      `📝 *${subjectName} - Индивидуальный заказ*\n\n` +
      `🎓 *Курс:* ${courseName}\n\n` +
      `📝 *Шаг 1: Описание задания*\n\n` +
      `${promptText}`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Приём текстового описания для индивидуального заказа
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // Пропускаем если это не индивидуальный заказ в режиме ожидания описания
    if (!ctx.session.customOrder || ctx.session.customOrder.step !== 'waiting_description') {
      return next();
    }
    
    const customOrder = ctx.session.customOrder;
    customOrder.description = ctx.message.text;
    customOrder.step = 'waiting_file';
    
    await ctx.reply(
      `✅ *Описание получено!*\n\n` +
      `📎 *Шаг 2: Файл задания*\n\n` +
      `Теперь прикрепите файл с вашим заданием (фото, PDF, DOCX и т.д.)\n\n` +
      `📁 Вы можете отправить один файл или несколько файлов.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Приём файла для индивидуального заказа
  bot.on(['photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // Пропускаем если это не индивидуальный заказ в режиме ожидания файла
    if (!ctx.session.customOrder || ctx.session.customOrder.step !== 'waiting_file') {
      return next();
    }
    
    const customOrder = ctx.session.customOrder;
    const fileInfo = {};
    
    if (ctx.message.photo) {
      fileInfo.type = 'photo';
      fileInfo.fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      fileInfo.fileName = `Фото_${Date.now()}.jpg`;
    } else if (ctx.message.document) {
      fileInfo.type = 'document';
      fileInfo.fileId = ctx.message.document.file_id;
      fileInfo.fileName = ctx.message.document.file_name || `Файл_${Date.now()}`;
    }
    
    customOrder.file = fileInfo;
    customOrder.step = 'confirmation';
    
    // Показываем страницу подтверждения
    await showConfirmation(ctx);
  });

  // Показать подтверждение индивидуального заказа
  async function showConfirmation(ctx) {
    const customOrder = ctx.session.customOrder;
    const work = catalog.getWork(customOrder.workId);
    const { subjectName, courseName } = getSubjectFullName(work);
    
    let summary = `📝 *Подтверждение индивидуального заказа*\n\n`;
    summary += `🎓 *Курс:* ${courseName}\n`;
    summary += `📚 *Предмет:* ${subjectName}\n\n`;
    summary += `📝 *Описание задания:*\n\`${escapeMarkdown(customOrder.description)}\`\n\n`;
    
    if (customOrder.file) {
      summary += `📎 *Прикреплённый файл:* ${customOrder.file.fileName}\n\n`;
    }
    
    summary += `Проверьте информацию и выберите действие:`;
    
    const buttons = [
      [{ text: '✅ Отправить заказ на оценку', callback: 'custom_order:send_for_evaluation' }],
      [{ text: '✏️ Изменить описание', callback: 'custom_order:edit_description' }],
      [{ text: '📎 Изменить файл', callback: 'custom_order:edit_file' }]
    ];
    
    await ctx.reply(summary, { 
      parse_mode: 'Markdown', 
      reply_markup: createInlineKeyboard(buttons).reply_markup 
    });
  }

  // Изменить описание
  bot.action('custom_order:edit_description', async (ctx) => {
    const customOrder = ctx.session.customOrder;
    if (!customOrder) return ctx.answerCbQuery('❌ Заказ не найден');
    
    customOrder.step = 'waiting_description';
    await ctx.editMessageText(
      `✏️ *Редактирование описания*\n\n` +
      `Отправьте новое текстовое описание задания:`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Изменить файл
  bot.action('custom_order:edit_file', async (ctx) => {
    const customOrder = ctx.session.customOrder;
    if (!customOrder) return ctx.answerCbQuery('❌ Заказ не найден');
    
    customOrder.file = null;
    customOrder.step = 'waiting_file';
    await ctx.editMessageText(
      `📎 *Загрузка нового файла*\n\n` +
      `Прикрепите файл с вашим заданием:`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Отправить заказ на оценку
  bot.action('custom_order:send_for_evaluation', async (ctx) => {
    const customOrder = ctx.session.customOrder;
    if (!customOrder || !customOrder.description || !customOrder.file) {
      return ctx.answerCbQuery('❌ Неполный заказ. Заполните все поля.');
    }
    
    const work = catalog.getWork(customOrder.workId);
    const { subjectName, courseName } = getSubjectFullName(work);
    const { chatId } = getWorkConfig(work);
    
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;
    const createdAt = new Date().toLocaleString('ru-RU');
    
    if (!chatId) {
      await ctx.reply(`❌ Ошибка: Не настроен ${work.chatEnv} в .env файле`);
      return;
    }
    
    // Создаём предварительный заказ
    const tempOrderNumber = `C-${Date.now()}`;
    
    let orderText = `🔔 *НОВЫЙ ИНДИВИДУАЛЬНЫЙ ЗАКАЗ!*\\n\\n`;
    orderText += `🆔 *Номер заказа:* №${tempOrderNumber}\\n`;
    orderText += `👤 *Заказчик:* ${userLink}\\n`;
    orderText += `🎓 *Курс:* ${courseName}\\n`;
    orderText += `📚 *Предмет:* ${subjectName}\\n`;
    orderText += `📝 *Описание:* ${escapeMarkdown(customOrder.description)}\\n`;
    orderText += `📎 *Файл:* ${customOrder.file.fileName}\\n`;
    orderText += `⏰ *Создан:* ${createdAt}\\n`;
    orderText += `🟡 *Статус:* ОЖИДАЕТ ОЦЕНКИ`;
    
    try {
      // Отправляем в чат исполнителей
      const sentMsg = await ctx.telegram.sendMessage(chatId, orderText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard([
          [{ text: '💰 Назначить цену', callback: `custom_set_price:${ctx.from.id}_${tempOrderNumber}` }],
          [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${ctx.from.id}_${tempOrderNumber}` }]
        ]).reply_markup
      });
      
      // Отправляем файл следом
      if (customOrder.file.type === 'photo') {
        await ctx.telegram.sendPhoto(chatId, customOrder.file.fileId, { 
          caption: `📎 Файл задания: ${customOrder.file.fileName}`,
          reply_to_message_id: sentMsg.message_id 
        });
      } else {
        await ctx.telegram.sendDocument(chatId, customOrder.file.fileId, { 
          caption: `📎 Файл задания: ${customOrder.file.fileName}`,
          reply_to_message_id: sentMsg.message_id 
        });
      }
      
      // Сохраняем состояние для обработки цены и сообщений
      customOrderStates.set(tempOrderNumber, {
        customerId: ctx.from.id,
        customerUsername: ctx.from.username,
        workId: customOrder.workId,
        subjectName: subjectName,
        courseName: courseName,
        description: customOrder.description,
        fileName: customOrder.file.fileName,
        fileId: customOrder.file.fileId,
        fileType: customOrder.file.type,
        createdAt: createdAt,
        status: 'waiting_price',
        managerMessageId: sentMsg.message_id,
        chatId: chatId,
        commission: work.commission || 20
      });
      
      await ctx.reply(
        `✅ *Ваш заказ отправлен на оценку!*\n\n` +
        `🆔 *Номер заказа:* №${tempOrderNumber}\n` +
        `📚 *Предмет:* ${subjectName}\n\n` +
        `Ожидайте, исполнители ознакомятся с заданием и назначат цену.\n` +
        `Как только цена будет назначена, вы получите уведомление.`,
        { parse_mode: 'Markdown' }
      );
      
      // Очищаем сессию
      ctx.session.customOrder = null;
      
      await ctx.answerCbQuery('✅ Заказ отправлен на оценку');
    } catch (error) {
      console.error('Ошибка отправки индивидуального заказа:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа.');
    }
  });

  // Установить цену для индивидуального заказа
  bot.action(/^custom_set_price:(\d+)_(.+)$/, async (ctx) => {
    const executorId = parseInt(ctx.match[1]);
    const orderNumber = ctx.match[2];
    
    if (executorId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const orderData = customOrderStates.get(orderNumber);
    if (!orderData) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    await ctx.editMessageText(
      `💰 *Назначение цены*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${orderData.subjectName}\n\n` +
      `Отправьте цену заказа в рублях (только число):`,
      { parse_mode: 'Markdown' }
    );
    
    // Устанавливаем состояние ожидания цены
    ctx.session.waitingCustomPrice = { orderNumber, executorId };
    await ctx.answerCbQuery();
  });

  // Обработка введённой цены
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomPrice) {
      return next();
    }
    
    const { orderNumber, executorId } = ctx.session.waitingCustomPrice;
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingCustomPrice = null;
      return ctx.reply('❌ Заказ не найден. Начните заново.');
    }
    
    const price = parseInt(ctx.message.text);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ Пожалуйста, введите корректную цену (положительное число).');
    }
    
    // Сохраняем цену
    orderData.price = price;
    orderData.executorId = executorId;
    orderData.status = 'price_set';
    
    const executorUser = ctx.from;
    const executorName = executorUser.username ? `@${executorUser.username}` : executorUser.first_name;
    
    // Формируем сообщение для заказчика
    const customerMessage = 
      `💰 *Назначена цена за ваш заказ*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${orderData.subjectName}\n` +
      `🎓 *Курс:* ${orderData.courseName}\n` +
      `📅 *Дата заказа:* ${orderData.createdAt}\n` +
      `💵 *Назначенная цена:* ${price} ₽\n\n` +
      `Выберите действие:`;
    
    const customerKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Перейти к оплате', `custom_pay:${orderNumber}`)],
      [Markup.button.callback('✉️ Написать исполнителю', `custom_write_executor:${orderNumber}`)]
    ]);
    
    try {
      // Отправляем сообщение заказчику
      await ctx.telegram.sendMessage(
        orderData.customerId,
        customerMessage,
        { 
          parse_mode: 'Markdown',
          reply_markup: customerKeyboard
        }
      );
      
      // Обновляем сообщение в чате исполнителей
      let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ*\n\n`;
      updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
      updatedText += `👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}\n`;
      updatedText += `📚 *Предмет:* ${orderData.subjectName}\n`;
      updatedText += `💰 *Цена:* ${price} ₽\n`;
      updatedText += `👷 *Исполнитель:* ${executorName}\n`;
      updatedText += `🟢 *Статус:* ОЖИДАЕТ ОПЛАТЫ`;
      
      await ctx.telegram.editMessageText(orderData.chatId, orderData.managerMessageId, null, updatedText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard([
          [{ text: '💰 Изменить цену', callback: `custom_set_price:${executorId}_${orderNumber}` }],
          [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${executorId}_${orderNumber}` }]
        ]).reply_markup
      });
      
      await ctx.reply(`✅ Цена ${price} ₽ назначена. Ожидайте оплаты от заказчика.`);
      
      ctx.session.waitingCustomPrice = null;
      await ctx.answerCbQuery('✅ Цена назначена');
    } catch (error) {
      console.error('Ошибка назначения цены:', error);
      await ctx.reply('❌ Произошла ошибка при назначении цены.');
    }
  });

  // Написать сообщение заказчику (из чата исполнителей)
  bot.action(/^custom_write_customer:(\d+)_(.+)$/, async (ctx) => {
    const executorId = parseInt(ctx.match[1]);
    const orderNumber = ctx.match[2];
    
    if (executorId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const orderData = customOrderStates.get(orderNumber);
    if (!orderData) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    await ctx.editMessageText(
      `✉️ *Написать сообщение заказчику*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingCustomMessageToCustomer = { orderNumber, executorId };
    await ctx.answerCbQuery();
  });

  // Обработка сообщения исполнителя заказчику
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomMessageToCustomer) {
      return next();
    }
    
    const { orderNumber, executorId } = ctx.session.waitingCustomMessageToCustomer;
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingCustomMessageToCustomer = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const executorUser = ctx.from;
    const executorName = executorUser.username ? `@${executorUser.username}` : executorUser.first_name;
    
    // Пересылаем сообщение заказчику
    const customerMessage = 
      `💬 *Вам сообщение от исполнителя*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${orderData.subjectName}\n` +
      `👷 *Исполнитель:* ${executorName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Для ответа используйте кнопку ниже:`;
    
    const replyKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить исполнителю', `custom_reply_executor:${orderNumber}`)]
    ]);
    
    try {
      await ctx.telegram.sendMessage(orderData.customerId, customerMessage, {
        parse_mode: 'Markdown',
        reply_markup: replyKeyboard
      });
      
      await ctx.reply('✅ Сообщение отправлено заказчику.');
      
      ctx.session.waitingCustomMessageToCustomer = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения заказчику:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

  // Ответить исполнителю (от заказчика)
  bot.action(/^custom_reply_executor:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    await ctx.editMessageText(
      `✏️ *Написать ответ исполнителю*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingCustomReplyToExecutor = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка ответа заказчика исполнителю
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomReplyToExecutor) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomReplyToExecutor;
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingCustomReplyToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerUser = ctx.from;
    const customerName = customerUser.username ? `@${customerUser.username}` : customerUser.first_name;
    
    // Отправляем сообщение в чат исполнителей
    const executorMessage = 
      `💬 *Вам сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Для ответа используйте кнопки:`;
    
    const executorKeyboard = createInlineKeyboard([
      [{ text: '💰 Изменить цену', callback: `custom_set_price:${orderData.executorId}_${orderNumber}` }],
      [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderData.executorId}_${orderNumber}` }]
    ]);
    
    try {
      await ctx.telegram.sendMessage(orderData.chatId, executorMessage, {
        parse_mode: 'Markdown',
        reply_markup: executorKeyboard.reply_markup
      });
      
      await ctx.reply('✅ Сообщение отправлено исполнителю.');
      
      ctx.session.waitingCustomReplyToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения исполнителю:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

  // Перейти к оплате
  bot.action(/^custom_pay:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const work = catalog.getWork(orderData.workId);
    const { paymentValue } = getWorkConfig(work);
    
    if (!paymentValue) {
      return ctx.reply(`❌ Ошибка: Не настроен ${work.paymentEnv} в .env файле`);
    }
    
    await ctx.editMessageText(
      `💳 *Оплата заказа*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `💵 *Сумма к оплате:* ${orderData.price} ₽\n\n` +
      `Переведите сумму на карту:\n` +
      `\`${paymentValue}\`\n\n` +
      `📸 *После оплаты отправьте скриншот чека в этот чат.*`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingCustomPayment = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка скриншота оплаты
  bot.on(['photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomPayment) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomPayment;
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return next();
    }
    
    // Получаем файл скриншота
    let fileId, fileType;
    if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      fileType = 'photo';
    } else if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      fileType = 'document';
    }
    
    try {
      // Отправляем скриншот в чат исполнителей
      const paymentMsg = `💳 *ПОДТВЕРЖДЕНИЕ ОПЛАТЫ*\n\n🆔 *Номер заказа:* №${orderNumber}\n👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}`;
      
      if (fileType === 'photo') {
        await ctx.telegram.sendPhoto(orderData.chatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
      } else {
        await ctx.telegram.sendDocument(orderData.chatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
      }
      
      // Обновляем статус заказа
      orderData.status = 'paid';
      orderData.paidAt = new Date().toLocaleString('ru-RU');
      
      // Обновляем сообщение в чате исполнителей
      let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ*\n\n`;
      updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
      updatedText += `👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}\n`;
      updatedText += `📚 *Предмет:* ${orderData.subjectName}\n`;
      updatedText += `💰 *Цена:* ${orderData.price} ₽\n`;
      updatedText += `👷 *Исполнитель:* ${orderData.executorId ? '@' + (await ctx.telegram.getChat(orderData.executorId)).username : 'Не назначен'}\n`;
      updatedText += `✅ *Оплачен:* ${orderData.paidAt}\n`;
      updatedText += `🟢 *Статус:* ОПЛАЧЕН - В РАБОТЕ`;
      
      await ctx.telegram.editMessageText(orderData.chatId, orderData.managerMessageId, null, updatedText, {
        parse_mode: 'Markdown'
      });
      
      await ctx.reply(
        `✅ *Оплата подтверждена!*\n\n` +
        `🆔 *Номер заказа:* №${orderNumber}\n` +
        `💵 *Сумма:* ${orderData.price} ₽\n\n` +
        `Ваш заказ передан исполнителю. Ожидайте выполнения работы.`,
        { parse_mode: 'Markdown' }
      );
      
      // Создаём запись в базе заказов
      const work = catalog.getWork(orderData.workId);
      const newOrder = orders.createOrder({
        workId: orderData.workId,
        workTitle: `${orderData.subjectName}`,
        subjectName: orderData.subjectName,
        courseName: orderData.courseName,
        customerId: orderData.customerId,
        customerUsername: orderData.customerUsername,
        executorId: orderData.executorId,
        price: orderData.price,
        commission: orderData.commission,
        createdAt: orderData.createdAt,
        paidAt: orderData.paidAt,
        status: 'paid',
        orderNumber: orderNumber
      });
      
      ctx.session.waitingCustomPayment = null;
    } catch (error) {
      console.error('Ошибка обработки оплаты:', error);
      await ctx.reply('❌ Произошла ошибка. Напишите менеджеру.');
    }
  });

  // Написать исполнителю (от заказчика, когда цена ещё не оплачена)
  bot.action(/^custom_write_executor:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    await ctx.editMessageText(
      `✏️ *Написать исполнителю*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingCustomWriteToExecutor = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка сообщения заказчика исполнителю (до оплаты)
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomWriteToExecutor) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomWriteToExecutor;
    const orderData = customOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingCustomWriteToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerUser = ctx.from;
    const customerName = customerUser.username ? `@${customerUser.username}` : customerUser.first_name;
    
    // Отправляем в чат исполнителей
    const executorMessage = 
      `💬 *Сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Действия:`;
    
    const executorKeyboard = createInlineKeyboard([
      [{ text: '💰 Изменить цену', callback: `custom_set_price:${orderData.executorId}_${orderNumber}` }],
      [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderData.executorId}_${orderNumber}` }]
    ]);
    
    try {
      await ctx.telegram.sendMessage(orderData.chatId, executorMessage, {
        parse_mode: 'Markdown',
        reply_markup: executorKeyboard.reply_markup
      });
      
      await ctx.reply('✅ Сообщение отправлено исполнителю. Ожидайте ответа.');
      
      ctx.session.waitingCustomWriteToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });
}

module.exports = { register };
