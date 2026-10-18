const { Markup } = require('telegraf');
const { escapeHtml } = require('./html');

/**
 * Универсальный композер сообщений.
 * Позволяет собрать сообщение (текст + файл) с превью перед отправкой.
 */

// Режимы композера: определяют, куда и как отправлять
const COMPOSER_MODES = {
  admin_to_customer: {
    label: 'администратор → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от администрации по заказу №${composer.orderNumber}</b>\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить администратору', `admin_reply:${composer.targetUserId}_${composer.orderId}_${composer.senderId}`)
      ]]).reply_markup
    })
  },
  admin_to_customer_generic: {
    label: 'администратор → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от администрации</b>\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить администратору', `admin_reply:${composer.targetUserId}_${composer.orderId || '—'}_${composer.senderId}`)
      ]]).reply_markup
    })
  },
  customer_to_admin: {
    label: 'заказчик → администратор',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Ответ заказчика по заказу №${composer.orderNumber}</b>\n\n` +
            `👤 <b>Заказчик:</b> ${escapeHtml(ctx.from.username ? '@' + ctx.from.username : 'ID: ' + ctx.from.id)}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить заказчику', `admin_reply_to_customer:${ctx.from.id}_${composer.orderId}`)
      ]]).reply_markup
    })
  },
  executor_to_customer: {
    label: 'исполнитель → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от исполнителя</b>\n\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить исполнителю', `customer_reply_msg:${composer.senderId}_${composer.orderNumber}`)],
        [Markup.button.callback('📎 Отправить файл исполнителю', `customer_reply_file:${composer.senderId}_${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  customer_to_executor: {
    label: 'заказчик → исполнитель',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от заказчика</b>\n\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить заказчику', `executor_reply_msg2:${ctx.from.id}_${composer.orderNumber}`)],
        [Markup.button.callback('📎 Отправить файл заказчику', `executor_reply_file2:${ctx.from.id}_${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  support_to_user: {
    label: 'менеджер → пользователь',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Сообщение от менеджера:</b>\n\n${escapeHtml(composer.text)}`,
      keyboard: null
    })
  },
  custom_executor_to_customer: {
    label: 'исполнитель → заказчик (инд. заказ)',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от исполнителя</b>\n\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Предмет:</b> ${escapeHtml(composer.orderTitle)}\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить исполнителю', `custom_reply_executor:${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  custom_customer_to_executor: {
    label: 'заказчик → исполнитель (инд. заказ)',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Сообщение от заказчика</b>\n\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `👤 <b>Заказчик:</b> ${escapeHtml(ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name)}\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💰 Изменить цену', `custom_set_price:${composer.orderNumber}`)],
        [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  dept_to_customer: {
    label: 'руководитель отдела → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от руководителя отдела по заказу №${composer.orderNumber}</b>\n\n${escapeHtml(composer.text)}`,
      keyboard: null
    })
  }
};

/**
 * Запускает режим композера
 */
function startComposer(ctx, mode, options = {}) {
  ctx.session = ctx.session || {};
  ctx.session.messageComposer = {
    mode,
    targetUserId: options.targetUserId,
    orderId: options.orderId || null,
    orderNumber: options.orderNumber || '—',
    orderTitle: options.orderTitle || 'Заказ',
    senderId: ctx.from.id,
    text: null,
    file: null,
    step: 'waiting_text', // waiting_text | waiting_file | preview
    previewMessageId: null
  };
}

/**
 * Показывает превью сообщения с кнопками
 */
async function showPreview(ctx) {
  const composer = ctx.session.messageComposer;
  
  let previewText = `📝 <b>Предпросмотр сообщения</b>\n\n`;
  previewText += `📤 <b>Кому:</b> ${COMPOSER_MODES[composer.mode].label}\n\n`;
  
  if (composer.text) {
    previewText += `💬 <b>Текст:</b>\n${escapeHtml(composer.text)}\n\n`;
  } else {
    previewText += `💬 <b>Текст:</b> <i>не задан</i>\n\n`;
  }
  
  if (composer.file) {
    previewText += `📎 <b>Файл:</b> ${escapeHtml(composer.file.fileName)}\n`;
  }

  const buttons = [];
  
  if (!composer.text) {
    buttons.push([Markup.button.callback('✏️ Ввести текст', `mc:edit_text`)]);
  } else {
    buttons.push([Markup.button.callback('✏️ Изменить текст', `mc:edit_text`)]);
  }
  
  if (!composer.file) {
    buttons.push([Markup.button.callback('📎 Добавить файл', `mc:add_file`)]);
  } else {
    buttons.push([Markup.button.callback('📎 Изменить файл', `mc:add_file`)]);
  }
  
  buttons.push([Markup.button.callback('✅ Отправить', `mc:send`)]);
  buttons.push([Markup.button.callback('❌ Отмена', `mc:cancel`)]);

  const keyboard = Markup.inlineKeyboard(buttons);

  // Если превью уже есть — редактируем, иначе создаём
  if (composer.previewMessageId) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        composer.previewMessageId,
        null,
        previewText,
        { parse_mode: 'HTML', ...keyboard }
      );
    } catch (e) {
      const msg = await ctx.reply(previewText, { parse_mode: 'HTML', ...keyboard });
      composer.previewMessageId = msg.message_id;
    }
  } else {
    const msg = await ctx.reply(previewText, { parse_mode: 'HTML', ...keyboard });
    composer.previewMessageId = msg.message_id;
  }
}

/**
 * Обрабатывает текстовое сообщение в режиме композера
 * @returns {boolean} true если сообщение обработано композером
 */
async function handleComposerText(ctx, next) {
  ctx.session = ctx.session || {};
  const composer = ctx.session.messageComposer;
  
  if (!composer) return false;
  
  if (composer.step === 'waiting_text') {
    composer.text = ctx.message.text;
    composer.step = 'preview';
    await showPreview(ctx);
    return true;
  }
  
  return false;
}

/**
 * Обрабатывает файл в режиме композера
 * @returns {boolean} true если файл обработан композером
 */
async function handleComposerFile(ctx, next) {
  ctx.session = ctx.session || {};
  const composer = ctx.session.messageComposer;
  
  if (!composer) return false;
  
  if (composer.step === 'waiting_file') {
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
    
    composer.file = fileInfo;
    composer.step = 'preview';
    await showPreview(ctx);
    return true;
  }
  
  return false;
}

/**
 * Отправляет собранное сообщение получателю
 */
async function sendMessage(ctx) {
  const composer = ctx.session.messageComposer;
  const modeConfig = COMPOSER_MODES[composer.mode];
  
  if (!modeConfig) {
    await ctx.answerCbQuery('❌ Неизвестный режим отправки');
    return;
  }
  
  const { text, keyboard } = modeConfig.buildMessage(ctx, composer);
  
  try {
    // 🌟 Сначала показываем "Отправляю..." чтобы убрать часики
    await ctx.answerCbQuery('⏳ Отправляю...');
    
    // Отправляем текст получателю
    await ctx.telegram.sendMessage(composer.targetUserId, text, {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {})
    });
    
    // Отправляем файл, если есть
    if (composer.file) {
      if (composer.file.type === 'photo') {
        await ctx.telegram.sendPhoto(composer.targetUserId, composer.file.fileId);
      } else {
        await ctx.telegram.sendDocument(composer.targetUserId, composer.file.fileId);
      }
    }
    
    // 🌟 Редактируем превью → показываем что отправлено
    if (composer.previewMessageId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          composer.previewMessageId,
          null,
          `✅ <b>Сообщение отправлено</b>\n\n📤 ${modeConfig.label}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { /* превью могло быть удалено */ }
    }
    
    // Очищаем композер
    ctx.session.messageComposer = null;
    
  } catch (err) {
    // 🌟 Ошибка тоже через уведомление
    await ctx.answerCbQuery('❌ Ошибка отправки').catch(() => {});
    await ctx.reply(`❌ Не удалось отправить сообщение: ${escapeHtml(err.message)}`);
  }
}

/**
 * Регистрирует обработчики кнопок композера
 */
function registerComposerActions(bot) {
  // Изменить текст
  bot.action('mc:edit_text', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    composer.step = 'waiting_text';
    await ctx.editMessageText(
      '✏️ <b>Введите текст сообщения:</b>',
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('✏️ Введите текст');
  });
  
  // Добавить/изменить файл
  bot.action('mc:add_file', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    composer.step = 'waiting_file';
    await ctx.editMessageText(
      '📎 <b>Пришлите файл или фото:</b>',
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('📎 Жду файл');
  });
  
  // Отправить
  bot.action('mc:send', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    if (!composer.text && !composer.file) {
      return ctx.answerCbQuery('❌ Сообщение пустое. Добавьте текст или файл.');
    }
    
    // 🌟 НЕ вызываем answerCbQuery здесь — он будет вызван внутри sendMessage
    await sendMessage(ctx);
  });
  
  // Отмена
  bot.action('mc:cancel', async (ctx) => {
    ctx.session.messageComposer = null;
    // 🌟 Удаляем превью вместо редактирования
    try {
      await ctx.deleteMessage();
    } catch (e) { /* ignore */ }
    // 🌟 Всплывающее уведомление
    await ctx.answerCbQuery('❌ Отправка отменена');
  });
}

/**
 * Обработчик кнопок запуска композера из других модулей
 * Формат: mc_start:{mode}:{orderNumber}:{targetUserId}
 */
function registerComposerStartActions(bot) {
  bot.action(/^mc_start:(\w+):(\d+|—):(\d+)$/, async (ctx) => {
    const mode = ctx.match[1];
    const orderNumber = ctx.match[2];
    const targetUserId = parseInt(ctx.match[3]);
    
    // Получаем данные заказа для заголовка
    const orders = require('../data/orders');
    const order = orders.getOrderByNumber(orderNumber !== '—' ? parseInt(orderNumber) : orderNumber);
    
    const modeMap = {
      'executor_to_customer': {
        mode: 'executor_to_customer',
        title: order ? order.workTitle : 'Заказ'
      },
      'customer_to_executor': {
        mode: 'customer_to_executor',
        title: order ? order.workTitle : 'Заказ'
      }
    };
    
    const config = modeMap[mode];
    if (!config) {
      return ctx.answerCbQuery('❌ Неизвестный режим');
    }
    
    startComposer(ctx, config.mode, {
      targetUserId: targetUserId,
      orderId: order ? order.id : null,
      orderNumber: orderNumber,
      orderTitle: config.title
    });
    
    await ctx.reply(
      `✏️ <b>Написать сообщение</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(config.title)}\n\nОтправьте текст сообщения:`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery();
  });
}

module.exports = {
  startComposer,
  handleComposerText,
  handleComposerFile,
  registerComposerActions,
  registerComposerStartActions,
  COMPOSER_MODES
};