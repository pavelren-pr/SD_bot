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
  },
  // 🌟 НОВОЕ: Рассылка персоналу
  broadcast: {
    label: 'рассылка персоналу',
    buildMessage: (ctx, composer) => ({
      text: `📢 <b>Сообщение от администрации</b>\n\n${escapeHtml(composer.text)}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('🔕 Скрыть', 'dismiss_broadcast')]
      ]).reply_markup
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
    files: [],              // 🌟 Массив файлов вместо одного
    step: 'waiting_text',
    previewMessageId: null,
    broadcastTargets: options.broadcastTargets || null,
    broadcastGroupLabel: options.broadcastGroupLabel || null
  };
}

/**
 * Показывает превью сообщения с кнопками
 */
async function showPreview(ctx) {
  const composer = ctx.session.messageComposer;
  
  let previewText = `📝 <b>Предпросмотр сообщения</b>\n\n`;
  if (composer.broadcastTargets && composer.broadcastTargets.length > 0) {
    previewText += `📤 <b>Кому:</b> ${escapeHtml(composer.broadcastGroupLabel)} (${composer.broadcastTargets.length} чел.)\n\n`;
  } else {
    previewText += `📤 <b>Кому:</b> ${COMPOSER_MODES[composer.mode].label}\n\n`;
  }
  
  if (composer.text) {
    previewText += `💬 <b>Текст:</b>\n${escapeHtml(composer.text)}\n\n`;
  } else {
    previewText += `💬 <b>Текст:</b> <i>не задан</i>\n\n`;
  }
  
  // 🌟 Показываем все файлы
  if (composer.files && composer.files.length > 0) {
    previewText += `📎 <b>Файлы (${composer.files.length}):</b>\n`;
    composer.files.forEach((f, i) => {
      previewText += `  ${i + 1}. ${escapeHtml(f.fileName)}\n`;
    });
    previewText += `\n`;
  }

  const buttons = [];
  if (!composer.text) {
    buttons.push([Markup.button.callback('✏️ Ввести текст', `mc:edit_text`)]);
  } else {
    buttons.push([Markup.button.callback('✏️ Изменить текст', `mc:edit_text`)]);
  }
  // 🌟 Кнопка файла: "Добавить" или "Добавить ещё"
  if (!composer.files || composer.files.length === 0) {
    buttons.push([Markup.button.callback('📎 Добавить файл', `mc:add_file`)]);
  } else {
    buttons.push([Markup.button.callback('📎 Добавить ещё файл', `mc:add_file`)]);
    buttons.push([Markup.button.callback('🗑 Удалить все файлы', `mc:clear_files`)]);
  }
  buttons.push([Markup.button.callback('✅ Отправить', `mc:send`)]);
  buttons.push([Markup.button.callback('❌ Отмена', `mc:cancel`)]);

  const keyboard = Markup.inlineKeyboard(buttons);

  if (composer.previewMessageId) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id, composer.previewMessageId, null,
        previewText, { parse_mode: 'HTML', ...keyboard }
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
const composerMediaBuffer = {}; // 🌟 Буфер для медиагрупп (несколько фото/файлов одновременно)

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
    } else {
      return false;
    }

    // 🌟 Обработка медиагрупп (несколько файлов одновременно)
    if (ctx.message.media_group_id) {
      const groupId = ctx.message.media_group_id;
      if (!composerMediaBuffer[groupId]) {
        composerMediaBuffer[groupId] = { files: [], timer: null };
      }
      composerMediaBuffer[groupId].files.push(fileInfo);

      // Сбрасываем таймер при каждом новом файле группы
      if (composerMediaBuffer[groupId].timer) {
        clearTimeout(composerMediaBuffer[groupId].timer);
      }

      // Когда все файлы группы получены (ждём 1 секунду после последнего)
      composerMediaBuffer[groupId].timer = setTimeout(async () => {
        const bufferedFiles = composerMediaBuffer[groupId].files;
        delete composerMediaBuffer[groupId];

        // Инициализируем массив файлов если его нет
        if (!composer.files) composer.files = [];

        // Добавляем все файлы из группы
        for (const file of bufferedFiles) {
          composer.files.push(file);
        }

        // Показываем превью с обновлённым списком
        composer.step = 'preview';
        try {
          await showPreview(ctx);
        } catch (e) {
          console.log('Ошибка показа превью после медиагруппы:', e.message);
        }
      }, 1000);

      return true;
    }

    // 🌟 Одиночный файл
    if (!composer.files) composer.files = [];
    composer.files.push(fileInfo);
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
    // ==========================================
    // 🌟 РЕЖИМ РАССЫЛКИ (несколько получателей)
    // ==========================================
    if (composer.broadcastTargets && composer.broadcastTargets.length > 0) {
      await ctx.answerCbQuery('⏳ Рассылаю...');
      
      let sentCount = 0;
      let failedCount = 0;
      
      for (const targetId of composer.broadcastTargets) {
        try {
          await ctx.telegram.sendMessage(targetId, text, {
            parse_mode: 'HTML',
            ...(keyboard ? { reply_markup: keyboard } : {})
          });
          // 🌟 Отправляем все файлы
          if (composer.files && composer.files.length > 0) {
            for (const file of composer.files) {
              if (file.type === 'photo') {
                await ctx.telegram.sendPhoto(targetId, file.fileId);
              } else {
                await ctx.telegram.sendDocument(targetId, file.fileId);
              }
            }
          }
          sentCount++;
        } catch (e) {
          failedCount++;
        }
      }
      
      // 🌟 Отчёт об отправке
      let reportText = `✅ <b>Рассылка завершена!</b>\n\n`;
      reportText += `👥 <b>Группа:</b> ${escapeHtml(composer.broadcastGroupLabel || 'персонал')}\n`;
      reportText += `📤 <b>Отправлено:</b> ${sentCount}\n`;
      if (failedCount > 0) {
        reportText += `❌ <b>Не доставлено:</b> ${failedCount}\n<i>(заблокировали бота или не начинали чат)</i>\n`;
      }
      
      // Обновляем превью или отправляем отчёт
      if (composer.previewMessageId) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, composer.previewMessageId, null, reportText, { parse_mode: 'HTML' });
        } catch (e) {
          await ctx.reply(reportText, { parse_mode: 'HTML' });
        }
      } else {
        await ctx.reply(reportText, { parse_mode: 'HTML' });
      }
      
      ctx.session.messageComposer = null;
      return;
    }
    
    // ==========================================
    // ОБЫЧНЫЙ РЕЖИМ (один получатель)
    // ==========================================
    await ctx.answerCbQuery('⏳ Отправляю...');
    
    await ctx.telegram.sendMessage(composer.targetUserId, text, {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {})
    });
    
    if (composer.files && composer.files.length > 0) {
      for (const file of composer.files) {
        if (file.type === 'photo') {
          await ctx.telegram.sendPhoto(composer.targetUserId, file.fileId);
        } else {
          await ctx.telegram.sendDocument(composer.targetUserId, file.fileId);
        }
      }
    }
    
    if (composer.previewMessageId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id, composer.previewMessageId, null,
          `✅ <b>Сообщение отправлено</b>\n\n📤 ${modeConfig.label}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { /* ignore */ }
    }
    
    ctx.session.messageComposer = null;
    
  } catch (err) {
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
    
    const filesCount = (composer.files || []).length;
    composer.step = 'waiting_file';
    
    let prompt = '📎 <b>Пришлите файлы или фото:</b>\n\n';
    prompt += 'Можно отправить:\n';
    prompt += '• Один файл/фото\n';
    prompt += '• Несколько фото одновременно (группой)\n\n';
    if (filesCount > 0) {
      prompt += `📎 <b>Уже добавлено файлов:</b> ${filesCount}\n`;
      prompt += `Новые файлы будут добавлены к существующим.`;
    }
    
    await ctx.editMessageText(prompt, { parse_mode: 'HTML' });
    await ctx.answerCbQuery('📎 Жду файл');
  });
  
  // Отправить
  bot.action('mc:send', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    const hasFiles = composer.files && composer.files.length > 0;
    if (!composer.text && !hasFiles) {
      return ctx.answerCbQuery('❌ Сообщение пустое. Добавьте текст или файл.');
    }
    
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

  // 🌟 НОВОЕ: Удалить все файлы
  bot.action('mc:clear_files', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    composer.files = [];
    await showPreview(ctx);
    await ctx.answerCbQuery('🗑 Файлы удалены');
  });

  // 🌟 Кнопка "Скрыть" для рассылки — удаляет сообщение у получателя
  bot.action('dismiss_broadcast', async (ctx) => {
    try {
      await ctx.deleteMessage();
      await ctx.answerCbQuery();
    } catch (e) {
      await ctx.answerCbQuery();
    }
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