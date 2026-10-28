const { Markup } = require('telegraf');
const { escapeHtml } = require('./html');

// 🌟 Буфер для медиагрупп (несколько фото/файлов одновременно)
const composerMediaBuffer = {};

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
    files: [],              
    step: 'waiting_message', // 🌟 Универсальный шаг ожидания
    previewMessageId: null,
    broadcastTargets: options.broadcastTargets || null,
    broadcastGroupLabel: options.broadcastGroupLabel || null
  };
}

// Режимы композера
const COMPOSER_MODES = {
  admin_to_customer: {
    label: 'администратор → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от администрации по заказу №${composer.orderNumber}</b>${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить администратору', `admin_reply:${composer.targetUserId}_${composer.orderId}_${composer.senderId}`)
      ]]).reply_markup
    })
  },
  admin_to_customer_generic: {
    label: 'администратор → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от администрации</b>${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить администратору', `admin_reply:${composer.targetUserId}_${composer.orderId || '—'}_${composer.senderId}`)
      ]]).reply_markup
    })
  },
  customer_to_admin: {
    label: 'заказчик → администратор',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Ответ заказчика по заказу №${composer.orderNumber}</b>\n` +
            `👤 <b>Заказчик:</b> ${escapeHtml(ctx.from.username ? '@' + ctx.from.username : 'ID: ' + ctx.from.id)}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([[
        Markup.button.callback('✏️ Ответить заказчику', `admin_reply_to_customer:${ctx.from.id}_${composer.orderId}`)
      ]]).reply_markup
    })
  },
  executor_to_customer: {
    label: 'исполнитель → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от исполнителя</b>\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить исполнителю', `customer_reply:${composer.senderId}_${composer.orderNumber}`)] // 🌟 УНИВЕРСАЛЬНАЯ КНОПКА
      ]).reply_markup
    })
  },
  customer_to_executor: {
    label: 'заказчик → исполнитель',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от заказчика</b>\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Заказ:</b> ${escapeHtml(composer.orderTitle)}${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить заказчику', `executor_reply:${ctx.from.id}_${composer.orderNumber}`)] // 🌟 УНИВЕРСАЛЬНАЯ КНОПКА
      ]).reply_markup
    })
  },
  support_to_user: {
    label: 'менеджер → пользователь',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Сообщение от менеджера:</b>${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: null
    })
  },
  custom_executor_to_customer: {
    label: 'исполнитель → заказчик (инд. заказ)',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Вам сообщение от исполнителя</b>\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `📚 <b>Предмет:</b> ${escapeHtml(composer.orderTitle)}${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ответить исполнителю', `custom_reply_executor:${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  custom_customer_to_executor: {
    label: 'заказчик → исполнитель (инд. заказ)',
    buildMessage: (ctx, composer) => ({
      text: `💬 <b>Сообщение от заказчика</b>\n` +
            `🆔 <b>Номер заказа:</b> №${composer.orderNumber}\n` +
            `👤 <b>Заказчик:</b> ${escapeHtml(ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name)}${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💰 Изменить цену', `custom_set_price:${composer.orderNumber}`)],
        [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${composer.orderNumber}`)]
      ]).reply_markup
    })
  },
  dept_to_customer: {
    label: 'руководитель отдела → заказчик',
    buildMessage: (ctx, composer) => ({
      text: `📬 <b>Сообщение от руководителя отдела по заказу №${composer.orderNumber}</b>${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: null
    })
  },
  broadcast: {
    label: 'рассылка персоналу',
    buildMessage: (ctx, composer) => ({
      text: `📢 <b>Сообщение от администрации</b>${composer.text ? '\n\n' + escapeHtml(composer.text) : ''}`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('🔕 Скрыть', 'dismiss_broadcast')]
      ]).reply_markup
    })
  }
};

/**
 * 🌟 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ: Обрабатывает любое входящее сообщение
 */
async function handleComposerInput(ctx,next){
    ctx.session=ctx.session||{};
    const composer=ctx.session.messageComposer;
    if(!composer)return false;
    
    let hasContent=false;
    
    // 1. Извлекаем текст (из обычного текста или из подписи к медиа)
    const incomingText=ctx.message.text||ctx.message.caption||null;
    if(incomingText){
        if(composer.text){
            composer.text+='\n\n'+incomingText;
        } else {
            composer.text=incomingText;
        }
        hasContent=true;
    }
    
    // 2. Извлекаем медиа (фото или документ)
    let fileInfo=null;
    if(ctx.message.photo&&ctx.message.photo.length>0){
        fileInfo={
            type: 'photo',
            fileId: ctx.message.photo[ctx.message.photo.length-1].file_id,
            fileName: `Фото_${Date.now()}.jpg`
        };
    } else if(ctx.message.document){
        fileInfo={
            type: 'document',
            fileId: ctx.message.document.file_id,
            fileName: ctx.message.document.file_name||`Файл_${Date.now()}`
        };
    }
    
    if(fileInfo){
        hasContent=true;
        if(!composer.files)composer.files=[];
        
        if(ctx.message.media_group_id){
            const groupId=ctx.message.media_group_id;
            if(!composerMediaBuffer[groupId]){
                composerMediaBuffer[groupId]={files: [],timer: null};
            }
            composerMediaBuffer[groupId].files.push(fileInfo);
            if(composerMediaBuffer[groupId].timer){
                clearTimeout(composerMediaBuffer[groupId].timer);
            }
            composerMediaBuffer[groupId].timer=setTimeout(async()=>{
                const bufferedFiles=composerMediaBuffer[groupId].files;
                delete composerMediaBuffer[groupId];
                for(const f of bufferedFiles){
                    composer.files.push(f);
                }
                composer.step='preview';
                try{
                    await showPreview(ctx);
                } catch(e){
                    console.log('Ошибка показа превью после медиагруппы:',e.message);
                }
            },1000);
            return true;
        } else {
            composer.files.push(fileInfo);
        }
    }
    
    // 🌟 КРИТИЧНО: Если нет ни текста, ни файлов - возвращаем false
    if(!hasContent)return false;
    
    composer.step='preview';
    
    try{
        await showPreview(ctx);
    } catch(e){
        console.log('Ошибка показа превью:',e.message);
        // 🌟 ВАЖНО: даже если showPreview упал, мы уже добавили контент
        // и должны вернуть true, чтобы сообщение не ушло в поддержку
    }
    
    return true;
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
  
  if (composer.files && composer.files.length > 0) {
    previewText += `📎 <b>Файлы (${composer.files.length}):</b>\n`;
    composer.files.forEach((f, i) => {
      previewText += `  ${i + 1}. ${escapeHtml(f.fileName)}\n`;
    });
    previewText += `\n`;
  }

  previewText += `💡 <i>Вы можете отправить ещё сообщения — они добавятся к текущему, или нажать "Отправить".</i>`;

  const buttons = [];
  const hasText = !!composer.text;
  const hasFiles = composer.files && composer.files.length > 0;
  
  if (hasText || hasFiles) {
    buttons.push([Markup.button.callback('🗑 Очистить всё', `mc:clear_all`)]);
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
    if (composer.broadcastTargets && composer.broadcastTargets.length > 0) {
      await ctx.answerCbQuery('⏳ Отправляю рассылку...');
      let successCount = 0;
      let failCount = 0;
      
      for (const targetId of composer.broadcastTargets) {
        try {
          if (composer.text) {
            await ctx.telegram.sendMessage(targetId, text, {
              parse_mode: 'HTML',
              ...(keyboard ? { reply_markup: keyboard } : {})
            });
          }
          if (composer.files && composer.files.length > 0) {
            for (const file of composer.files) {
              if (file.type === 'photo') {
                await ctx.telegram.sendPhoto(targetId, file.fileId);
              } else {
                await ctx.telegram.sendDocument(targetId, file.fileId);
              }
            }
          }
          successCount++;
        } catch (e) {
          failCount++;
        }
      }
      
      await ctx.reply(
        `✅ <b>Рассылка завершена!</b>\n\n📤 Успешно: <b>${successCount}</b>\n❌ Ошибок: <b>${failCount}</b>`,
        { parse_mode: 'HTML' }
      );
      ctx.session.messageComposer = null;
      return;
    }
    
    await ctx.answerCbQuery('⏳ Отправляю...');
    
    const hasText = !!composer.text;
    const hasFiles = composer.files && composer.files.length > 0;

    if (hasFiles) {
      // 🌟 Отправляем файлы. Текст прикрепляем как подпись к первому файлу.
      for (let i = 0; i < composer.files.length; i++) {
        const file = composer.files[i];
        const isFirst = i === 0;
        
        const options = {};
        if (isFirst) {
          options.parse_mode = 'HTML';
          if (keyboard) options.reply_markup = keyboard;
          if (hasText) {
            options.caption = text; 
          } else if (keyboard) {
            options.caption = `📎 <b>Вам прислали файлы</b>`;
          }
        }
        
        if (file.type === 'photo') {
          await ctx.telegram.sendPhoto(composer.targetUserId, file.fileId, options);
        } else {
          await ctx.telegram.sendDocument(composer.targetUserId, file.fileId, options);
        }
      }
    } else if (hasText) {
      await ctx.telegram.sendMessage(composer.targetUserId, text, {
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {})
      });
    }
    
    ctx.session.messageComposer = null;
    try {
      await ctx.deleteMessage();
    } catch (e) { /* ignore */ }
    
    await ctx.reply('✅ <b>Сообщение успешно отправлено!</b>', { parse_mode: 'HTML' });
    
  } catch (err) {
    console.error('Ошибка отправки сообщения:', err);
    await ctx.reply('❌ Произошла ошибка при отправке сообщения.');
  }
}

function registerComposerActions(bot) {
  bot.action('mc:send', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    const hasFiles = composer.files && composer.files.length > 0;
    if (!composer.text && !hasFiles) {
      return ctx.answerCbQuery('❌ Сообщение пустое. Добавьте текст или файл.');
    }
    await sendMessage(ctx);
  });
  
  bot.action('mc:cancel', async (ctx) => {
    ctx.session.messageComposer = null;
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.answerCbQuery('❌ Отправка отменена');
  });

  bot.action('mc:clear_all', async (ctx) => {
    const composer = ctx.session.messageComposer;
    if (!composer) return ctx.answerCbQuery('❌ Сессия не найдена');
    
    composer.text = null;
    composer.files = [];
    composer.step = 'waiting_message';
    
    await showPreview(ctx);
    await ctx.answerCbQuery('🗑 Всё очищено');
  });

  bot.action('dismiss_broadcast', async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.answerCbQuery();
  });
}

function registerComposerStartActions(bot) {
  bot.action(/^mc_start:(\w+):(\d+|—):(\d+)$/, async (ctx) => {
    const mode = ctx.match[1];
    const orderNumber = ctx.match[2];
    const targetUserId = parseInt(ctx.match[3]);
    
    const orders = require('../data/orders');
    const order = orders.getOrderByNumber(orderNumber !== '—' ? parseInt(orderNumber) : orderNumber);
    
    const modeMap = {
      'executor_to_customer': { mode: 'executor_to_customer', title: order ? order.workTitle : 'Заказ' },
      'customer_to_executor': { mode: 'customer_to_executor', title: order ? order.workTitle : 'Заказ' }
    };
    
    const config = modeMap[mode];
    if (!config) return ctx.answerCbQuery('❌ Неизвестный режим');
    
    startComposer(ctx, config.mode, {
      targetUserId: targetUserId,
      orderId: order ? order.id : null,
      orderNumber: orderNumber,
      orderTitle: config.title
    });
    
    await ctx.reply(
      `✏️ <b>Написать сообщение</b>\n\n📚 <b>Заказ:</b> ${escapeHtml(config.title)}\n\nОтправьте ваше сообщение (текст, фото или файл):`,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'mc:cancel')]]).reply_markup }
    );
    await ctx.answerCbQuery();
  });
}

module.exports = { 
  startComposer, 
  handleComposerInput,
  registerComposerActions, 
  registerComposerStartActions,
  handleComposerText: handleComposerInput,
  handleComposerFile: handleComposerInput
};