const catalog = require('../data/catalog');
const orders = require('../data/orders');
const loyalty = require('../data/loyalty');
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
    { 
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Продолжить без отправки файла', 'custom_order:skip_file')]
      ]).reply_markup
    }
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
      summary += `📎 *Прикреплённый файл:* ${escapeMarkdown(customOrder.file.fileName)}\n\n`;
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
    ctx.session = ctx.session || {};
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
    ctx.session = ctx.session || {};
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

  // 🌟 Продолжить без отправки файла
bot.action('custom_order:skip_file', async (ctx) => {
  ctx.session = ctx.session || {};
  const customOrder = ctx.session.customOrder;
  if (!customOrder || customOrder.step !== 'waiting_file') {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  
  customOrder.file = null;
  customOrder.step = 'confirmation';
  
  // Сразу отправляем заказ на оценку без файла
  await sendOrderForEvaluation(ctx);
  await ctx.answerCbQuery('✅ Заказ отправлен на оценку без файла');
});

  // Отправить заказ на оценку
bot.action('custom_order:send_for_evaluation', async (ctx) => {
  ctx.session = ctx.session || {};
  const customOrder = ctx.session.customOrder;
  if (!customOrder || !customOrder.description) {
    return ctx.answerCbQuery('❌ Неполный заказ. Заполните описание.');
  }
  
  await sendOrderForEvaluation(ctx);
  await ctx.answerCbQuery("✅ Заказ отправлен на оценку");
});

// 🌟 Общая функция отправки заказа на оценку
async function sendOrderForEvaluation(ctx) {
  const customOrder = ctx.session.customOrder;
  const work = catalog.getWork(customOrder.workId);
  const { subjectName, courseName } = getSubjectFullName(work);
  const { chatId } = getWorkConfig(work);
  const userLink = ctx.from.username ? `@${ctx.from.username}` : `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;
  const createdAt = new Date().toLocaleString('ru-RU');

  if (!chatId) {
    await ctx.reply(`❌ Ошибка: Не настроен ${work.chatEnv} в .env файле`);
    return;
  }

  const orderData = orders.createOrder({
    customerId: ctx.from.id,
    customerUsername: ctx.from.username,
    workId: customOrder.workId,
    workTitle: `${subjectName} - Индивидуальный заказ`,
    subjectName: subjectName,
    courseName: courseName,
    price: 0,
    commission: work.commission || 20,
    description: customOrder.description,
    fileName: customOrder.file ? customOrder.file.fileName : null,
    fileId: customOrder.file ? customOrder.file.fileId : null,
    fileType: customOrder.file ? customOrder.file.type : null,
    status: "waiting_acceptance",
    isCustomOrder: true
  });

  const orderNumber = orderData.orderNumber;

  let orderText = `🔔 *НОВЫЙ ИНДИВИДУАЛЬНЫЙ ЗАКАЗ!*\n\n`;
  orderText += `🆔 *Номер заказа:* №${orderNumber}\n`;
  orderText += `👤 *Заказчик:* ${userLink}\n`;
  orderText += `🎓 *Курс:* ${courseName}\n`;
  orderText += `📚 *Предмет:* ${subjectName}\n`;
  orderText += `📝 *Описание:* ${escapeMarkdown(customOrder.description)}\n`;
  // 🌟 Файл указываем только если он есть
  if (customOrder.file) {
    orderText += `📎 *Файл:* ${escapeMarkdown(customOrder.file.fileName)}\n`;
  } else {
    orderText += `📎 *Файл:* ❌ Не прикреплён\n`;
  }
  orderText += `⏰ *Создан:* ${createdAt}\n`;
  orderText += `🟡 *Статус:* ОЖИДАЕТ ОЦЕНКИ`;

  try {
    const sentMsg = await ctx.telegram.sendMessage(chatId, orderText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Принять заказ", callback_data: `accept_custom_order:${orderNumber}` }]
        ]
      }
    });

    customOrderStates.set(orderNumber, {
      orderId: orderData.id,
      managerMessageId: sentMsg.message_id,
      chatId: chatId
    });

    // 🌟 Отправляем файл только если он есть
    if (customOrder.file) {
      if (customOrder.file.type === "photo") {
        await ctx.telegram.sendPhoto(chatId, customOrder.file.fileId, { 
          caption: `📎 Файл задания: ${escapeMarkdown(customOrder.file.fileName)}`,
          reply_to_message_id: sentMsg.message_id 
        });
      } else {
        await ctx.telegram.sendDocument(chatId, customOrder.file.fileId, { 
          caption: `📎 Файл задания: ${escapeMarkdown(customOrder.file.fileName)}`,
          reply_to_message_id: sentMsg.message_id 
        });
      }
    }

    await ctx.reply(
      `✅ *Ваш заказ отправлен на оценку!*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${subjectName}\n\n` +
      `Ожидайте, исполнители ознакомятся с заданием и назначат цену.\n` +
      `Как только цена будет назначена, вы получите уведомление.`,
      { parse_mode: "Markdown" }
    );

    ctx.session.customOrder = null;
  } catch (error) {
    console.error("Ошибка отправки индивидуального заказа:", error);
    await ctx.reply("❌ Произошла ошибка при отправке заказа.");
  }
}

  // Обработчик кнопки "Принять заказ"
  bot.action(/^accept_custom_order:(\d+)$/, async (ctx) => {
    const orderNumber = parseInt(ctx.match[1]);
    
    // Получаем заказ из orders.json
    const orderRecord = orders.getOrderByNumber(orderNumber);
    if (!orderRecord) {
      return ctx.answerCbQuery('❌ Заказ не найден');
    }
    
    if (orderRecord.status !== 'waiting_acceptance') {
      return ctx.answerCbQuery('❌ Заказ уже принят другим исполнителем');
    }
    
    // Проверяем, не принял ли уже кто-то этот заказ
    if (orderRecord.executorId && orderRecord.executorId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Этот заказ уже принят другим исполнителем');
    }
    
    // Обновляем заказ в orders.json
    const updatedOrder = orders.updateOrder(orderRecord.id, {
      executorId: ctx.from.id,
      executorUsername: ctx.from.username || null,
      status: 'waiting_price',
      acceptedAt: new Date().toLocaleString('ru-RU')
    });
    
    const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Сохраняем в кэш для быстрого доступа
    customOrderStates.set(orderNumber, {
      orderId: orderRecord.id,
      managerMessageId: ctx.callbackQuery.message.message_id, // Будет обновлено ниже
      chatId: ctx.chat.id
    });
    
    // Обновляем сообщение в чате исполнителей
    let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ ПРИНЯТ*\n\n`;
    updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
    updatedText += `👤 *Заказчик:* ${orderRecord.customerUsername ? '@' + orderRecord.customerUsername : 'ID: ' + orderRecord.customerId}\n`;
    updatedText += `📚 *Предмет:* ${orderRecord.subjectName}\n`;
    updatedText += `👷 *Исполнитель:* ${executorName}\n`;
    updatedText += `🟡 *Статус:* ОЖИДАЕТ ОЦЕНКИ`;
    
let backKeyboard;
if (orderRecord.status === 'paid') {
  backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
  ]);
} else {
  backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Назначить цену', `custom_set_price:${orderNumber}`)],
    [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
  ]);
}
await ctx.editMessageText(updatedText, {
  parse_mode: 'Markdown',
  reply_markup: backKeyboard.reply_markup
});
    
    await ctx.answerCbQuery('✅ Вы приняли заказ. Теперь можете назначить цену.');
  });

// Установить цену для индивидуального заказа
bot.action(/^custom_set_price:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  if (!orderRecord.executorId) {
    return ctx.answerCbQuery('❌ Сначала примите заказ кнопкой "✅ Принять заказ"');
  }
  if (orderRecord.executorId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ Это не ваш заказ. Сначала нажмите "Принять заказ".');
  }
  
  const promptText = `💰 *${orderRecord.price && orderRecord.price > 0 ? 'Изменение цены' : 'Назначение цены'}*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n` +
    `📚 *Предмет:* ${orderRecord.subjectName}${orderRecord.price && orderRecord.price > 0 ? '\n💵 *Текущая цена:* ' + orderRecord.price + ' ₽' : ''}\n\n` +
    `Отправьте ${orderRecord.price && orderRecord.price > 0 ? 'новую' : ''}цену заказа в рублях (только число):`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('↩️ Назад', `custom_back:${orderNumber}`)]
  ]).reply_markup;
  
  // 🌟 Проверяем: текстовое сообщение или медиа
  if (ctx.callbackQuery.message.text) {
    await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
  
  ctx.session.waitingCustomPrice = { orderNumber };
  await ctx.answerCbQuery();
});

// 🌟 Кнопка "Назад" — возврат к управлению заказом
bot.action(/^custom_back:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  if (orderRecord.executorId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ Это не ваш заказ.');
  }
  
  // Очищаем состояние ожидания цены
  ctx.session.waitingCustomPrice = null;
  
  const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  
  // Формируем сообщение управления заказом
  let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ*\n\n`;
  updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
  updatedText += `👤 *Заказчик:* ${orderRecord.customerUsername ? '@' + orderRecord.customerUsername : 'ID: ' + orderRecord.customerId}\n`;
  updatedText += `📚 *Предмет:* ${orderRecord.subjectName}\n`;
  if (orderRecord.price && orderRecord.price > 0) {
    updatedText += `💰 *Цена:* ${orderRecord.price} ₽\n`;
  }
  updatedText += `👷 *Исполнитель:* ${executorName}\n`;
  updatedText += `🟡 *Статус:* ${orderRecord.price && orderRecord.price > 0 ? 'СОГЛАСОВАНИЕ ЦЕНЫ' : 'ОЖИДАЕТ ОЦЕНКИ'}`;
  
  await ctx.editMessageText(updatedText, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('💰 Назначить цену', `custom_set_price:${orderNumber}`)],
      [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
    ]).reply_markup
  });
  await ctx.answerCbQuery();
});

  // Обработка введённой цены
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomPrice) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomPrice;
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord) {
      ctx.session.waitingCustomPrice = null;
      return ctx.reply('❌ Заказ не найден. Начните заново.');
    }
    
    // Проверяем, что текущий пользователь - исполнитель этого заказа
    if (orderRecord.executorId !== ctx.from.id) {
      return ctx.reply('❌ Это не ваш заказ.');
    }
    
    const price = parseInt(ctx.message.text);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ Пожалуйста, введите корректную цену (положительное число).');
    }
    
    // Обновляем заказ в orders.json
    const updatedOrder = orders.updateOrder(orderRecord.id, {
      price: price,
      status: 'price_negotiating'  // Статус: идёт согласование цены
    });
    
    const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Формируем сообщение для заказчика
    const customerMessage = 
      `💰 *Назначена цена за ваш заказ*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${updatedOrder.subjectName}\n` +
      `🎓 *Курс:* ${updatedOrder.courseName}\n` +
      `📅 *Дата заказа:* ${updatedOrder.createdAt}\n` +
      `💵 *Назначенная цена:* ${price} ₽\n\n` +
      `Вы можете обсудить цену с исполнителем или перейти к оплате:`;
    
    const customerKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✉️ Обсудить цену с исполнителем', `custom_write_executor:${orderNumber}`)],
      [Markup.button.callback('💳 Перейти к оплате', `custom_pay:${orderNumber}`)]
    ]);
    
    try {
      // Отправляем сообщение заказчику
      await ctx.telegram.sendMessage(
        updatedOrder.customerId,
        customerMessage,
        { 
          parse_mode: 'Markdown',
          reply_markup: customerKeyboard.reply_markup
        }
      );
      
      // Получаем данные из кэша для обновления сообщения в чате исполнителей
      const cacheData = customOrderStates.get(orderNumber);
      if (cacheData && cacheData.managerMessageId) {
        // Обновляем сообщение в чате исполнителей
        let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ*\n\n`;
        updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
        updatedText += `👤 *Заказчик:* ${updatedOrder.customerUsername ? '@' + updatedOrder.customerUsername : 'ID: ' + updatedOrder.customerId}\n`;
        updatedText += `📚 *Предмет:* ${updatedOrder.subjectName}\n`;
        updatedText += `💰 *Цена:* ${price} ₽\n`;
        updatedText += `👷 *Исполнитель:* ${executorName}\n`;
        updatedText += `🟡 *Статус:* СОГЛАСОВАНИЕ ЦЕНЫ`;
        
        await ctx.telegram.editMessageText(cacheData.chatId, cacheData.managerMessageId, null, updatedText, {
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard([
            [{ text: '💰 Изменить цену', callback: `custom_set_price:${orderNumber}` }],
            [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderNumber}` }]
          ]).reply_markup
        });
      }
      
      await ctx.reply(`✅ Цена ${price} ₽ назначена. Теперь заказчик может обсудить цену или перейти к оплате.`);
      
      ctx.session.waitingCustomPrice = null;
      
    } catch (error) {
      console.error('Ошибка назначения цены:', error);
      await ctx.reply('❌ Произошла ошибка при назначении цены.');
    }
  });

// Написать сообщение заказчику (из чата исполнителей)
bot.action(/^custom_write_customer:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  if (!orderRecord.executorId) {
    return ctx.answerCbQuery('❌ Сначала примите заказ кнопкой "✅ Принять заказ"');
  }
  if (orderRecord.executorId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ Это не ваш заказ. Сначала нажмите "Принять заказ".');
  }
  
  const promptText = `✉️ *Написать сообщение заказчику*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n\n` +
    `Отправьте ваше сообщение:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📎 Отправить файл', `custom_write_customer_file:${orderNumber}`)]
  ]).reply_markup;
  
  // 🌟 Проверяем: текстовое сообщение или медиа
  if (ctx.callbackQuery.message.text) {
    await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
  
  ctx.session.waitingCustomMessageToCustomer = { orderNumber };
  await ctx.answerCbQuery();
});

// 🌟 Отправить файл заказчику (от исполнителя)
bot.action(/^custom_write_customer_file:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  if (!orderRecord.executorId) {
    return ctx.answerCbQuery('❌ Сначала примите заказ кнопкой "✅ Принять заказ"');
  }
  if (orderRecord.executorId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ Это не ваш заказ.');
  }
  await ctx.editMessageText(
    `📎 *Отправить файл заказчику*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n\n` +
    `Прикрепите файл или фото:`,
    { parse_mode: 'Markdown' }
  );
  ctx.session.waitingCustomFileToCustomer = { orderNumber };
  await ctx.answerCbQuery();
});

  // Обработка сообщения исполнителя заказчику
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomMessageToCustomer) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomMessageToCustomer;
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord) {
      ctx.session.waitingCustomMessageToCustomer = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    // Проверяем, что текущий пользователь - исполнитель этого заказа
    if (orderRecord.executorId !== ctx.from.id) {
      return ctx.reply('❌ Это не ваш заказ.');
    }
    
    const messageText = ctx.message.text;
    const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Пересылаем сообщение заказчику
    const customerMessage = 
      `💬 *Вам сообщение от исполнителя*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `📚 *Предмет:* ${orderRecord.subjectName}\n` +
      `${messageText}\n\n` +
      `✏️ Для ответа используйте кнопку ниже:`;
    
    const replyKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Ответить исполнителю', `custom_reply_executor:${orderNumber}`)]
    ]);
    
    try {
      await ctx.telegram.sendMessage(orderRecord.customerId, customerMessage, {
        parse_mode: 'Markdown',
        reply_markup: replyKeyboard.reply_markup
      });
      
      await ctx.reply('✅ Сообщение отправлено заказчику.');
      
      ctx.session.waitingCustomMessageToCustomer = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения заказчику:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

// 🌟 Обработка файла от исполнителя заказчику
bot.on(['photo', 'document'], async (ctx, next) => {
  ctx.session = ctx.session || {};
  if (!ctx.session.waitingCustomFileToCustomer) {
    return next();
  }
  const { orderNumber } = ctx.session.waitingCustomFileToCustomer;
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    ctx.session.waitingCustomFileToCustomer = null;
    return ctx.reply('❌ Заказ не найден.');
  }
  // Проверяем, что текущий пользователь - исполнитель этого заказа
  if (orderRecord.executorId !== ctx.from.id) {
    return ctx.reply('❌ Это не ваш заказ.');
  }
  
  const executorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  
  // Получаем файл
  let fileId, fileType, fileName;
  if (ctx.message.photo) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    fileType = 'photo';
    fileName = `Фото_${Date.now()}.jpg`;
  } else if (ctx.message.document) {
    fileId = ctx.message.document.file_id;
    fileType = 'document';
    fileName = ctx.message.document.file_name || `Файл_${Date.now()}`;
  }
  
  const caption = 
    `📎 *Файл от исполнителя*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n` +
    `📚 *Предмет:* ${orderRecord.subjectName}\n` +
    `✏️ Для ответа используйте кнопку ниже:`;
  
  // 🌟 Клавиатура для ответа заказчику
  const replyKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Ответить исполнителю', `custom_reply_executor:${orderNumber}`)]
  ]);
  
  try {
    if (fileType === 'photo') {
      await ctx.telegram.sendPhoto(orderRecord.customerId, fileId, { 
        caption, 
        parse_mode: 'Markdown',
        reply_markup: replyKeyboard.reply_markup
      });
    } else {
      await ctx.telegram.sendDocument(orderRecord.customerId, fileId, { 
        caption, 
        parse_mode: 'Markdown',
        reply_markup: replyKeyboard.reply_markup
      });
    }
    await ctx.reply('✅ Файл отправлен заказчику.');
    ctx.session.waitingCustomFileToCustomer = null;
  } catch (error) {
    console.error('Ошибка отправки файла заказчику:', error);
    await ctx.reply('❌ Произошла ошибка.');
  }
});

// Ответить исполнителю (от заказчика)
bot.action(/^custom_reply_executor:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  
  const promptText = `✏️ *Написать ответ исполнителю*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n\n` +
    `Отправьте ваше сообщение:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📎 Отправить файл', `custom_reply_file:${orderNumber}`)]
  ]).reply_markup;
  
  // 🌟 Проверяем: текстовое сообщение или медиа
  if (ctx.callbackQuery.message.text) {
    await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
  
  ctx.session.waitingCustomReplyToExecutor = { orderNumber };
  await ctx.answerCbQuery();
});

// 🌟 Отправить файл исполнителю (от заказчика)
bot.action(/^custom_reply_file:(\d+)$/, async (ctx) => {
  ctx.session = ctx.session || {};
  const orderNumber = parseInt(ctx.match[1]);
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    return ctx.answerCbQuery('❌ Заказ не найден');
  }
  await ctx.editMessageText(
    `📎 *Отправить файл исполнителю*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n\n` +
    `Прикрепите файл или фото:`,
    { parse_mode: 'Markdown' }
  );
  ctx.session.waitingCustomReplyFileToExecutor = { orderNumber };
  await ctx.answerCbQuery();
});

  // Обработка ответа заказчика исполнителю
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    if (!ctx.session.waitingCustomReplyToExecutor) {
      return next();
    }
    
    const { orderNumber } = ctx.session.waitingCustomReplyToExecutor;
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord) {
      ctx.session.waitingCustomReplyToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Получаем данные из кэша
    const cacheData = customOrderStates.get(orderNumber);
    
    // Отправляем сообщение в чат исполнителей
    const executorMessage = 
      `💬 *Вам сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Для ответа используйте кнопки:`;
    
let executorKeyboardButtons;
if (orderRecord.status === 'paid') {
  executorKeyboardButtons = [
    [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderNumber}` }]
  ];
} else {
  executorKeyboardButtons = [
    [{ text: '💰 Изменить цену', callback: `custom_set_price:${orderNumber}` }],
    [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderNumber}` }]
  ];
}
const executorKeyboard = createInlineKeyboard(executorKeyboardButtons);
    
    try {
      if (cacheData && cacheData.chatId) {
        await ctx.telegram.sendMessage(cacheData.chatId, executorMessage, {
          parse_mode: 'Markdown',
          reply_markup: executorKeyboard.reply_markup
        });
      }
      
      await ctx.reply('✅ Сообщение отправлено исполнителю.');
      
      ctx.session.waitingCustomReplyToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения исполнителю:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });

// 🌟 Обработка файла от заказчика исполнителю
bot.on(['photo', 'document'], async (ctx, next) => {
  ctx.session = ctx.session || {};
  if (!ctx.session.waitingCustomReplyFileToExecutor) {
    return next();
  }
  const { orderNumber } = ctx.session.waitingCustomReplyFileToExecutor;
  const orderRecord = orders.getOrderByNumber(orderNumber);
  if (!orderRecord) {
    ctx.session.waitingCustomReplyFileToExecutor = null;
    return ctx.reply('❌ Заказ не найден.');
  }
  const customerName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  const cacheData = customOrderStates.get(orderNumber);
  
  // Получаем файл
  let fileId, fileType, fileName;
  if (ctx.message.photo) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    fileType = 'photo';
    fileName = `Фото_${Date.now()}.jpg`;
  } else if (ctx.message.document) {
    fileId = ctx.message.document.file_id;
    fileType = 'document';
    fileName = ctx.message.document.file_name || `Файл_${Date.now()}`;
  }
  
  const caption =
    `📎 *Файл от заказчика*\n\n` +
    `🆔 *Номер заказа:* №${orderNumber}\n` +
    `👤 *Заказчик:* ${customerName}\n` +
    `📄 *Файл:* ${escapeMarkdown(fileName)}`;
  
  // 🌟 Клавиатура для ответа заказчику
let executorKeyboard;
if (orderRecord.status === 'paid') {
  executorKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
  ]);
} else {
  executorKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Изменить цену', `custom_set_price:${orderNumber}`)],
    [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
  ]);
}
  
  try {
    if (cacheData && cacheData.chatId) {
      if (fileType === 'photo') {
        await ctx.telegram.sendPhoto(cacheData.chatId, fileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: executorKeyboard.reply_markup
        });
      } else {
        await ctx.telegram.sendDocument(cacheData.chatId, fileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: executorKeyboard.reply_markup
        });
      }
    }
    await ctx.reply('✅ Файл отправлен исполнителю.');
    ctx.session.waitingCustomReplyFileToExecutor = null;
  } catch (error) {
    console.error('Ошибка отправки файла исполнителю:', error);
    await ctx.reply('❌ Произошла ошибка.');
  }
});

  // Перейти к оплате
  bot.action(/^custom_pay:(\d+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const orderNumber = parseInt(ctx.match[1]);
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord || orderRecord.customerId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Это не ваш заказ');
    }
    
    // Проверяем, что цена назначена
    if (!orderRecord.price || orderRecord.price <= 0) {
      return ctx.answerCbQuery('❌ Цена ещё не назначена исполнителем');
    }
    
    const work = catalog.getWork(orderRecord.workId);
    const { paymentValue } = getWorkConfig(work);
    
    if (!paymentValue) {
      return ctx.reply(`❌ Ошибка: Не настроен ${work.paymentEnv} в .env файле`);
    }
    
    await ctx.editMessageText(
      `💳 *Оплата заказа*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `💵 *Стоимость выполнения:* ${orderRecord.price} ₽\n\n` +
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
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord || orderRecord.customerId !== ctx.from.id) {
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
      // Получаем данные из кэша
      const cacheData = customOrderStates.get(orderNumber);
      
      // Отправляем скриншот в чат исполнителей
      const paymentMsg = `💳 *ПОДТВЕРЖДЕНИЕ ОПЛАТЫ*\n\n🆔 *Номер заказа:* №${orderNumber}\n👤 *Заказчик:* ${orderRecord.customerUsername ? '@' + orderRecord.customerUsername : 'ID: ' + orderRecord.customerId}`;
      
      if (cacheData && cacheData.chatId) {
        if (fileType === 'photo') {
          await ctx.telegram.sendPhoto(cacheData.chatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
        } else {
          await ctx.telegram.sendDocument(cacheData.chatId, fileId, { caption: paymentMsg, parse_mode: 'Markdown' });
        }
      }
      
      // Обновляем статус заказа в orders.json
      const updatedOrder = orders.updateOrder(orderRecord.id, {
        status: 'paid',
        paidAt: new Date().toLocaleString('ru-RU')
      });

      // 🌟 ДОБАВИТЬ: начисляем сумму в loyalty
      loyalty.addToTotal(ctx.from.id, ctx.from.username, updatedOrder.price);
      
      // Обновляем сообщение в чате исполнителей
      if (cacheData && cacheData.managerMessageId && cacheData.chatId) {
        let updatedText = `🔔 *ИНДИВИДУАЛЬНЫЙ ЗАКАЗ*\n\n`;
        updatedText += `🆔 *Номер заказа:* №${orderNumber}\n`;
        updatedText += `👤 *Заказчик:* ${updatedOrder.customerUsername ? '@' + updatedOrder.customerUsername : 'ID: ' + updatedOrder.customerId}\n`;
        updatedText += `📚 *Предмет:* ${updatedOrder.subjectName}\n`;
        updatedText += `💰 *Цена:* ${updatedOrder.price} ₽\n`;
        updatedText += `👷 *Исполнитель:* ${updatedOrder.executorId ? '@' + (await ctx.telegram.getChat(updatedOrder.executorId)).username : 'Не назначен'}\n`;
        updatedText += `✅ *Оплачен:* ${updatedOrder.paidAt}\n`;
        updatedText += `🟢 *Статус:* ОПЛАЧЕН - В РАБОТЕ`;
        
        await ctx.telegram.editMessageText(cacheData.chatId, cacheData.managerMessageId, null, updatedText, {
          parse_mode: 'Markdown'
        });
      }
      
      await ctx.reply(
  `✅ *Оплата подтверждена!*\n\n` +
  `🆔 *Номер заказа:* №${orderNumber}\n` +
  `💵 *Сумма:* ${updatedOrder.price} ₽\n\n` +
  `Ваш заказ передан исполнителю. Ожидайте выполнения работы.\n\n` +
  `✏️ Если нужно уточнить детали, напишите исполнителю:`,
  { 
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Написать исполнителю', `custom_write_executor:${orderNumber}`)]
    ]).reply_markup
  }
);
      
      ctx.session.waitingCustomPayment = null;
    } catch (error) {
      console.error('Ошибка обработки оплаты:', error);
      await ctx.reply('❌ Произошла ошибка. Напишите менеджеру.');
    }
  });

  // Написать исполнителю (от заказчика, когда цена ещё не оплачена)
  bot.action(/^custom_write_executor:(\d+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    const orderNumber = parseInt(ctx.match[1]);
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord || orderRecord.customerId !== ctx.from.id) {
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
    const orderRecord = orders.getOrderByNumber(orderNumber);
    
    if (!orderRecord) {
      ctx.session.waitingCustomWriteToExecutor = null;
      return ctx.reply('❌ Заказ не найден.');
    }
    
    const messageText = ctx.message.text;
    const customerName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Получаем данные из кэша
    const cacheData = customOrderStates.get(orderNumber);
    
    // Отправляем в чат исполнителей
    const executorMessage = 
      `💬 *Сообщение от заказчика*\n\n` +
      `🆔 *Номер заказа:* №${orderNumber}\n` +
      `👤 *Заказчик:* ${customerName}\n\n` +
      `${messageText}\n\n` +
      `✏️ Действия:`;
    
let executorKeyboardButtons;
if (orderRecord.status === 'paid') {
  executorKeyboardButtons = [
    [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderNumber}` }]
  ];
} else {
  executorKeyboardButtons = [
    [{ text: '💰 Изменить цену', callback: `custom_set_price:${orderNumber}` }],
    [{ text: '✉️ Написать сообщение заказчику', callback: `custom_write_customer:${orderNumber}` }]
  ];
}
const executorKeyboard = createInlineKeyboard(executorKeyboardButtons);
    
    try {
      if (cacheData && cacheData.chatId) {
        await ctx.telegram.sendMessage(cacheData.chatId, executorMessage, {
          parse_mode: 'Markdown',
          reply_markup: executorKeyboard.reply_markup
        });
      }
      
      await ctx.reply('✅ Сообщение отправлено исполнителю. Ожидайте ответа.');
      
      ctx.session.waitingCustomWriteToExecutor = null;
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });
}

module.exports = { register };
