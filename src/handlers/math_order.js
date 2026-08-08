const catalog = require('../data/catalog');
const orders = require('../data/orders');
const loyalty = require('../data/loyalty');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');

// Хранилище состояний для математических заказов
const mathOrderStates = new Map();

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function register(bot) {
  // Обработка кнопки "Отправить задание" для Вышмата (1 и 2 курс)
  bot.action(/^order:start:(math_custom_1|math_custom_2)$/, async (ctx) => {
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    
    if (!work || !work.isCustomMath) {
      return next(); // Передаём управление стандартному обработчику
    }
    
    ctx.session = ctx.session || {};
    ctx.session.mathOrder = { 
      workId, 
      step: 'waiting_description', 
      description: null, 
      file: null 
    };
    
    await ctx.editMessageText(
      `📐 *Высшая математика - Индивидуальный заказ*\n\n` +
      `📝 *Шаг 1: Описание задания*\n\n` +
      `Пожалуйста, отправьте текстовое описание вашего задания:\n` +
      `• Сроки исполнения\n` +
      `• Дополнительная информация\n` +
      `• Другие важные детали\n\n` +
      `💡 *Подсказка:* После отправки текста вы сможете прикрепить файл с заданием.`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Приём текстового описания для математического заказа
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // Пропускаем если это не математический заказ
    if (!ctx.session.mathOrder || ctx.session.mathOrder.step !== 'waiting_description') {
      return next();
    }
    
    const mathOrder = ctx.session.mathOrder;
    mathOrder.description = ctx.message.text;
    mathOrder.step = 'waiting_file';
    
    await ctx.reply(
      `✅ *Описание получено!*\n\n` +
      `📎 *Шаг 2: Файл задания*\n\n` +
      `Теперь прикрепите файл с вашим заданием (фото, PDF, DOCX и т.д.)\n\n` +
      `📁 Вы можете отправить один файл или несколько файлов.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Приём файла для математического заказа
  bot.on(['photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // Пропускаем если это не математический заказ в режиме ожидания файла
    if (!ctx.session.mathOrder || ctx.session.mathOrder.step !== 'waiting_file') {
      return next();
    }
    
    const mathOrder = ctx.session.mathOrder;
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
    
    mathOrder.file = fileInfo;
    mathOrder.step = 'confirmation';
    
    // Показываем страницу подтверждения
    await showMathConfirmation(ctx);
  });

  // Показать подтверждение математического заказа
  async function showMathConfirmation(ctx) {
    const mathOrder = ctx.session.mathOrder;
    const work = catalog.getWork(mathOrder.workId);
    const subject = catalog.getSubject(work.subjectId);
    const course = catalog.getCourse(subject.courseId);
    
    let summary = `📐 *Подтверждение заказа по Высшей математике*\n\n`;
    summary += `🎓 *Курс:* ${course.name}\n`;
    summary += `📚 *Предмет:* ${subject.name}\n\n`;
    summary += `📝 *Описание задания:*\n\`${escapeMarkdown(mathOrder.description)}\`\n\n`;
    
    if (mathOrder.file) {
      summary += `📎 *Прикреплённый файл:* ${mathOrder.file.fileName}\n\n`;
    }
    
    summary += `Проверьте информацию и выберите действие:`;
    
    const buttons = [
      [{ text: '✅ Отправить заказ на оценку', callback: 'math_order:send_for_evaluation' }],
      [{ text: '✏️ Изменить описание', callback: 'math_order:edit_description' }],
      [{ text: '📎 Изменить файл', callback: 'math_order:edit_file' }]
    ];
    
    await ctx.reply(summary, { 
      parse_mode: 'Markdown', 
      reply_markup: createInlineKeyboard(buttons).reply_markup 
    });
  }

  // Изменить описание
  bot.action('math_order:edit_description', async (ctx) => {
    const mathOrder = ctx.session.mathOrder;
    if (!mathOrder) return ctx.answerCbQuery('❌ Заказ не найден');
    
    mathOrder.step = 'waiting_description';
    await ctx.editMessageText(
      `✏️ *Редактирование описания*\n\n` +
      `Отправьте новое текстовое описание задания:`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Изменить файл
  bot.action('math_order:edit_file', async (ctx) => {
    const mathOrder = ctx.session.mathOrder;
    if (!mathOrder) return ctx.answerCbQuery('❌ Заказ не найден');
    
    mathOrder.file = null;
    mathOrder.step = 'waiting_file';
    await ctx.editMessageText(
      `📎 *Загрузка нового файла*\n\n` +
      `Прикрепите файл с вашим заданием:`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  // Отправить заказ на оценку
  bot.action('math_order:send_for_evaluation', async (ctx) => {
    const mathOrder = ctx.session.mathOrder;
    if (!mathOrder || !mathOrder.description || !mathOrder.file) {
      return ctx.answerCbQuery('❌ incomplete заказ. Заполните все поля.');
    }
    
    const work = catalog.getWork(mathOrder.workId);
    const subject = catalog.getSubject(work.subjectId);
    const course = catalog.getCourse(subject.courseId);
    const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;
    const createdAt = new Date().toLocaleString('ru-RU');
    
    // Получаем ID чата математиков из env
    const mathChatId = process.env.MATH_CHAT_ID;
    if (!mathChatId) {
      await ctx.reply('❌ Ошибка: Не настроен MATH_CHAT_ID в .env файле');
      return;
    }
    
    // Создаём предварительный заказ
    const tempOrderNumber = `M-${Date.now()}`;
    
    let orderText = `🔔 *НОВЫЙ ЗАКАЗ ПО ВЫСШЕЙ МАТЕМАТИКЕ!*\n\n`;
    orderText += `🆔 *Номер заказа:* №${tempOrderNumber}\n`;
    orderText += `👤 *Заказчик:* ${userLink}\n`;
    orderText += `🎓 *Курс:* ${course.name}\n`;
    orderText += `📚 *Предмет:* ${subject.name}\n`;
    orderText += `📝 *Описание:* ${escapeMarkdown(mathOrder.description)}\n`;
    orderText += `📎 *Файл:* ${mathOrder.file.fileName}\n`;
    orderText += `⏰ *Создан:* ${createdAt}\n`;
    orderText += `🟡 *Статус:* ОЖИДАЕТ ОЦЕНКИ`;
    
    try {
      // Отправляем в чат математиков
      const sentMsg = await ctx.telegram.sendMessage(mathChatId, orderText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard([
          [{ text: '💰 Назначить цену', callback: `math_set_price:${ctx.from.id}_${tempOrderNumber}` }],
          [{ text: '✉️ Написать сообщение заказчику', callback: `math_write_customer:${ctx.from.id}_${tempOrderNumber}` }]
        ]).reply_markup
      });
      
      // Отправляем файл следом
      if (mathOrder.file.type === 'photo') {
        await ctx.telegram.sendPhoto(mathChatId, mathOrder.file.fileId, { 
          caption: `📎 Файл задания: ${mathOrder.file.fileName}`,
          reply_to_message_id: sentMsg.message_id 
        });
      } else {
        await ctx.telegram.sendDocument(mathChatId, mathOrder.file.fileId, { 
          caption: `📎 Файл задания: ${mathOrder.file.fileName}`,
          reply_to_message_id: sentMsg.message_id 
        });
      }
      
      // Сохраняем состояние для обработки цены и сообщений
      mathOrderStates.set(tempOrderNumber, {
        customerId: ctx.from.id,
        customerUsername: ctx.from.username,
        workId: mathOrder.workId,
        subjectName: subject.name,
        courseName: course.name,
        description: mathOrder.description,
        fileName: mathOrder.file.fileName,
        fileId: mathOrder.file.fileId,
        fileType: mathOrder.file.type,
        createdAt: createdAt,
        status: 'waiting_price',
        managerMessageId: sentMsg.message_id
      });
      
      await ctx.reply(
        `✅ *Ваш заказ отправлен на оценку!*\n\n` +
        `🆔 *Номер заказа:* №${tempOrderNumber}\n` +
        `📚 *Предмет:* ${subject.name}\n\n` +
        `Ожидайте, исполнители ознакомятся с заданием и назначат цену.\n` +
        `Как только цена будет назначена, вы получите уведомление.`,
        { parse_mode: 'Markdown' }
      );
      
      // Очищаем сессию
      ctx.session.mathOrder = null;
      
      await ctx.answerCbQuery('✅ Заказ отправлен на оценку');
    } catch (error) {
      console.error('Ошибка отправки математического заказа:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа.');
    }
  });

  // Установить цену для математического заказа
  bot.action(/^math_set_price:(\d+)_(.+)$/, async (ctx) => {
    const executorId = parseInt(ctx.match[1]);
    const orderNumber = ctx.match[2];
    
    if (executorId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const orderData = mathOrderStates.get(orderNumber);
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
    ctx.session.waitingMathPrice = { orderNumber, executorId };
    await ctx.answerCbQuery();
  });

  // Обработка введённой цены
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingMathPrice) {
      return next();
    }
    
    const { orderNumber, executorId } = ctx.session.waitingMathPrice;
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingMathPrice = null;
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
      [Markup.button.callback('💳 Перейти к оплате', `math_pay:${orderNumber}`)],
      [Markup.button.callback('✉️ Написать исполнителю', `math_write_executor:${orderNumber}`)]
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
      
      // Обновляем сообщение в чате математиков
      const mathChatId = process.env.MATH_CHAT_ID;
      let updatedText = `🔔 *ЗАКАЗ ПО ВЫСШЕЙ МАТЕМАТИКЕ*\n\n`;
      updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
      updatedText += `👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}\n`;
      updatedText += `📚 *Предмет:* ${orderData.subjectName}\n`;
      updatedText += `💰 *Цена:* ${price} ₽\n`;
      updatedText += `👷 *Исполнитель:* ${executorName}\n`;
      updatedText += `🟢 *Статус:* ОЖИДАЕТ ОПЛАТЫ`;
      
      await ctx.telegram.editMessageText(mathChatId, orderData.managerMessageId, null, updatedText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard([
          [{ text: '💰 Изменить цену', callback: `math_set_price:${executorId}_${orderNumber}` }],
          [{ text: '✉️ Написать сообщение заказчику', callback: `math_write_customer:${executorId}_${orderNumber}` }]
        ]).reply_markup
      });
      
      await ctx.reply(`✅ Цена ${price} ₽ назначена. Ожидайте оплаты от заказчика.`);
      
      ctx.session.waitingMathPrice = null;
      await ctx.answerCbQuery('✅ Цена назначена');
    } catch (error) {
      console.error('Ошибка назначения цены:', error);
      await ctx.reply('❌ Произошла ошибка при назначении цены.');
    }
  });

  // Написать сообщение заказчику (из чата математиков)
  bot.action(/^math_write_customer:(\d+)_(.+)$/, async (ctx) => {
    const executorId = parseInt(ctx.match[1]);
    const orderNumber = ctx.match[2];
    
    if (executorId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const orderData = mathOrderStates.get(orderNumber);
    if (!orderData) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    await ctx.editMessageText(
      `✉️ *Написать сообщение заказчику*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingMathMessageToCustomer = { orderNumber, executorId };
    await ctx.answerCbQuery();
  });

  // Обработка сообщения исполнителя заказчику
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingMathMessageToCustomer) {
      return next();
    }
    
    const { orderNumber, executorId } = ctx.session.waitingMathMessageToCustomer;
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingMathMessageToCustomer = null;
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
      [Markup.button.callback('✏️ Ответить исполнителю', `math_reply_executor:${orderNumber}`)]
    ]);
    
    try {
      await ctx.telegram.sendMessage(orderData.customerId, customerMessage, {
        parse_mode: 'Markdown',
        reply_markup: replyKeyboard
      });
      
      await ctx.reply('✅ Сообщение отправлено заказчику.');
      
      // Возвращаемся в режим ожидания действий в чате
      const mathChatId = process.env.MATH_CHAT_ID;
      await ctx.telegram.editMessageText(mathChatId, orderData.managerMessageId, null, 
        ctx.message.text, { parse_mode: 'Markdown' });
      
      ctx.session.waitingMathMessageToCustomer = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения заказчику:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

  // Ответить исполнителю (от заказчика)
  bot.action(/^math_reply_executor:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    await ctx.editMessageText(
      `✏️ *Написать ответ исполнителю*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingMathReplyToExecutor = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка ответа заказчика исполнителю
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingMathReplyToExecutor) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingMathReplyToExecutor;
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingMathReplyToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerUser = ctx.from;
    const customerName = customerUser.username ? `@${customerUser.username}` : customerUser.first_name;
    
    // Отправляем сообщение в чат математиков
    const mathChatId = process.env.MATH_CHAT_ID;
    const executorMessage = 
      `💬 *Вам сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Для ответа используйте кнопки:`;
    
    const executorKeyboard = createInlineKeyboard([
      [{ text: '💰 Изменить цену', callback: `math_set_price:${orderData.executorId}_${orderNumber}` }],
      [{ text: '✉️ Написать сообщение заказчику', callback: `math_write_customer:${orderData.executorId}_${orderNumber}` }]
    ]);
    
    try {
      await ctx.telegram.sendMessage(mathChatId, executorMessage, {
        parse_mode: 'Markdown',
        reply_markup: executorKeyboard.reply_markup
      });
      
      await ctx.reply('✅ Сообщение отправлено исполнителю.');
      
      ctx.session.waitingMathReplyToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения исполнителю:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

  // Перейти к оплате
  bot.action(/^math_pay:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    const cardNumber = process.env.IVAN_CARD_NUMB;
    if (!cardNumber) {
      return ctx.reply('❌ Ошибка: Не настроен IVAN_CARD_NUMB в .env файле');
    }
    
    await ctx.editMessageText(
      `💳 *Оплата заказа*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `💵 *Сумма к оплате:* ${orderData.price} ₽\n\n` +
      `Переведите сумму на карту:\n` +
      `\`${cardNumber}\`\n\n` +
      `📸 *После оплаты отправьте скриншот чека в этот чат.*`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingMathPayment = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка скриншота оплаты
  bot.on(['photo', 'document'], async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingMathPayment) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingMathPayment;
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return next();
    }
    
    const mathChatId = process.env.MATH_CHAT_ID;
    
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
      // Отправляем скриншот в чат математиков
      const paymentMsg = `💳 *ПОДТВЕРЖДЕНИЕ ОПЛАТЫ*\n\n🆔 *Номер заказа:* №${orderNumber}\n👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}`;
      
      if (fileType === 'photo') {
        await ctx.telegram.sendPhoto(mathChatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
      } else {
        await ctx.telegram.sendDocument(mathChatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
      }
      
      // Обновляем статус заказа
      orderData.status = 'paid';
      orderData.paidAt = new Date().toLocaleString('ru-RU');
      
      // Обновляем сообщение в чате математиков
      let updatedText = `🔔 *ЗАКАЗ ПО ВЫСШЕЙ МАТЕМАТИКЕ*\n\n`;
      updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
      updatedText += `👤 *Заказчик:* ${orderData.customerUsername ? '@' + orderData.customerUsername : 'ID: ' + orderData.customerId}\n`;
      updatedText += `📚 *Предмет:* ${orderData.subjectName}\n`;
      updatedText += `💰 *Цена:* ${orderData.price} ₽\n`;
      updatedText += `👷 *Исполнитель:* ${orderData.executorId ? '@' + (await ctx.telegram.getChat(orderData.executorId)).username : 'Не назначен'}\n`;
      updatedText += `✅ *Оплачен:* ${orderData.paidAt}\n`;
      updatedText += `🟢 *Статус:* ОПЛАЧЕН - В РАБОТЕ`;
      
      await ctx.telegram.editMessageText(mathChatId, orderData.managerMessageId, null, updatedText, {
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
      const newOrder = orders.createOrder({
        workId: orderData.workId,
        workTitle: `Вышмат (${orderData.subjectName})`,
        subjectName: orderData.subjectName,
        courseName: orderData.courseName,
        customerId: orderData.customerId,
        customerUsername: orderData.customerUsername,
        executorId: orderData.executorId,
        price: orderData.price,
        commission: 20,
        createdAt: orderData.createdAt,
        paidAt: orderData.paidAt,
        status: 'paid',
        orderNumber: orderNumber
      });
      
      ctx.session.waitingMathPayment = null;
    } catch (error) {
      console.error('Ошибка обработки оплаты:', error);
      await ctx.reply('❌ Произошла ошибка. Напишите менеджеру.');
    }
  });

  // Написать исполнителю (от заказчика, когда цена ещё не оплачена)
  bot.action(/^math_write_executor:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData || orderData.customerId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    await ctx.editMessageText(
      `✏️ *Написать исполнителю*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n\n` +
      `Отправьте ваше сообщение:`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.waitingMathWriteToExecutor = { orderNumber };
    await ctx.answerCbQuery();
  });

  // Обработка сообщения заказчика исполнителю (до оплаты)
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingMathWriteToExecutor) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingMathWriteToExecutor;
    const orderData = mathOrderStates.get(orderNumber);
    
    if (!orderData) {
      ctx.session.waitingMathWriteToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerUser = ctx.from;
    const customerName = customerUser.username ? `@${customerUser.username}` : customerUser.first_name;
    
    // Отправляем в чат математиков
    const mathChatId = process.env.MATH_CHAT_ID;
    const executorMessage = 
      `💬 *Сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Действия:`;
    
    const executorKeyboard = createInlineKeyboard([
      [{ text: '💰 Изменить цену', callback: `math_set_price:${orderData.executorId}_${orderNumber}` }],
      [{ text: '✉️ Написать сообщение заказчику', callback: `math_write_customer:${orderData.executorId}_${orderNumber}` }]
    ]);
    
    try {
      await ctx.telegram.sendMessage(mathChatId, executorMessage, {
        parse_mode: 'Markdown',
        reply_markup: executorKeyboard.reply_markup
      });
      
      await ctx.reply('✅ Сообщение отправлено исполнителю. Ожидайте ответа.');
      
      ctx.session.waitingMathWriteToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });
}

module.exports = { register };
