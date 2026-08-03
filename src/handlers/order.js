const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const { createInlineKeyboard } = require('../utils/keyboard');

function register(bot) {
  // ==========================================
  // ШАГ 1: Начало оформления
  // ==========================================
  bot.action(/^order:start:(.+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    
    ctx.session.order = {
      workId,
      step: 'waiting_details'
    };

    const promptText = `📎 Отлично!\n\n${work.prompt}`;
    await ctx.editMessageText(promptText);
  });

  // ==========================================
  // ШАГ 2: Получение деталей (Текст, Фото, Документ)
  // ==========================================
  bot.on(['text', 'photo', 'document'], async (ctx) => {
    if (ctx.chat?.type !== 'private') return;

    ctx.session = ctx.session || {};
    const order = ctx.session.order;

    // --- СЦЕНАРИЙ А: Пользователь присылает детали ЗАКАЗА ---
    if (order && order.step === 'waiting_details') {
      order.detailMessageId = ctx.message.message_id;
      
      if (ctx.message.text) {
        order.details = ctx.message.text;
      } else if (ctx.message.photo) {
        order.details = '[Фотография задания]';
      } else if (ctx.message.document) {
        order.details = `[Файл: ${ctx.message.document.file_name || 'документ'}]`;
      }
      
      order.step = 'confirm';

      const work = catalog.getWork(order.workId);
      const pricing = loyalty.calculatePrice(work.price, ctx.from.id);

      let summary = `🛒 *Подтверждение заказа*\n\n`;
      summary += `📌 Работа: ${work.title}\n`;
      summary += `💵 Базовая цена: ${pricing.basePrice} ₽\n`;
      if (pricing.discountPercent > 0) {
        summary += `🎉 Ваша скидка: -${pricing.discountPercent}%\n`;
      }
      summary += `✅ *Итого к оплате: ${pricing.finalPrice} ₽*\n\n`;
      summary += `Проверьте данные и нажмите кнопку ниже.`;

      await ctx.reply(summary, createInlineKeyboard([
        [{ text: '💳 Подтвердить и оплатить', callback: 'order:confirm' }]
      ]));
      return;
    }

    // --- СЦЕНАРИЙ Б: Пользователь присылает скриншот оплаты ---
    // 🌟 Теперь сохраняем workId после оформления, чтобы знать, в какой чат слать скриншот
    if (order && order.step === 'awaiting_payment') {
      const work = catalog.getWork(order.workId);
      const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
      
      const userLink = ctx.from.username 
        ? `@${ctx.from.username}` 
        : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;

      try {
        await ctx.telegram.sendMessage(
          targetChatId,
          `💳 *Пользователь прислал чек об оплате:*\n👤 ${userLink}\n📚 Работа: ${work.title}`,
          { parse_mode: 'Markdown' }
        );

        await ctx.forwardMessage(targetChatId, ctx.chat.id, ctx.message.message_id);
        await ctx.reply('✅ Спасибо! Менеджер получил ваш чек и скоро свяжется с вами.');
      } catch (error) {
        console.error('Ошибка при пересылке чека менеджеру:', error);
        await ctx.reply('❌ Произошла ошибка. Пожалуйста, напишите нам напрямую.');
      }
      return;
    }

    // --- СЦЕНАРИЙ В: Пользователь присылает сообщение без активного заказа ---
    const managerChatId = process.env.MY_CHAT_ID;
    const userLink = ctx.from.username 
      ? `@${ctx.from.username}` 
      : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;

    try {
      await ctx.telegram.sendMessage(
        managerChatId,
        `📸 *Пользователь прислал сообщение:*\n👤 ${userLink}`,
        { parse_mode: 'Markdown' }
      );

      await ctx.forwardMessage(managerChatId, ctx.chat.id, ctx.message.message_id);
      await ctx.reply('✅ Спасибо! Менеджер получил ваше сообщение и скоро свяжется с вами.');
    } catch (error) {
      console.error('Ошибка при пересылке сообщения менеджеру:', error);
      await ctx.reply('❌ Произошла ошибка. Пожалуйста, напишите нам напрямую.');
    }
  });

  // ==========================================
  // ШАГ 3: Подтверждение и уведомление менеджеров
  // ==========================================
  bot.action('order:confirm', async (ctx) => {
    ctx.session = ctx.session || {};
    const order = ctx.session.order;
    
    if (!order) {
      return ctx.answerCbQuery('❌ Заказ не найден. Начните заново через /start');
    }

    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);
    
    const targetChatId = process.env[work.chatEnv] || process.env.MY_CHAT_ID;
    const paymentDetails = process.env[work.paymentEnv] || 'Не указан';

    const userLink = ctx.from.username 
      ? `@${ctx.from.username}` 
      : `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;

    let managerMsg = `🔔 *НОВЫЙ ЗАКАЗ!*\n\n`;
    managerMsg += `👤 Заказчик: ${userLink}\n`;
    managerMsg += `📚 Работа: ${work.title}\n`;
    managerMsg += `💰 Сумма: ${pricing.finalPrice} ₽ (скидка ${pricing.discountPercent}%)\n`;
    managerMsg += `💳 Оплата на: \`${paymentDetails}\`\n`;
    
    if (order.details) {
      managerMsg += `\n📝 *Данные от пользователя:*\n${order.details}\n`;
    }
    
    managerMsg += `\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

    try {
      await ctx.telegram.sendMessage(targetChatId, managerMsg, { parse_mode: 'Markdown' });

      if (order.detailMessageId) {
        await ctx.forwardMessage(targetChatId, ctx.chat.id, order.detailMessageId);
      }

      // 🌟 Сохраняем workId для обработки скриншота оплаты, но меняем step
      order.step = 'awaiting_payment';
      
      await ctx.reply(
        `✅ Заказ успешно оформлен!\n\n` +
        `Для завершения переведите **${pricing.finalPrice} ₽** на карту/телефон:\n` +
        `\`${paymentDetails}\`\n\n` +
        `📸 *После оплаты просто пришлите скриншот чека в этот чат*, и менеджер сразу приступит к работе! 🚀`,
        { parse_mode: 'Markdown' }
      );
      
      await ctx.answerCbQuery('✅ Заказ отправлен!');
    } catch (error) {
      console.error('Ошибка при отправке заказа менеджеру:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа. Пожалуйста, напишите нам напрямую.');
    }
  });
}

module.exports = { register };