const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const { createInlineKeyboard } = require('../utils/keyboard');

function register(bot) {
  // Шаг 1: Начало оформления
  bot.action(/^order:start:(.+)$/, async (ctx) => {
    // Гарантируем, что сессия существует
    ctx.session = ctx.session || {};
    
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    
    ctx.session.order = {
      workId,
      step: 'waiting_details'
    };

    const promptText = work.askForFile 
      ? `📎 Отлично! Пришлите фото, файл с заданием или текстовое описание того, что нужно сделать.`
      : `📝 Отлично! Опишите текстом детали вашего заказа (сроки, особые пожелания).`;

    await ctx.editMessageText(promptText, { reply_markup: { remove_keyboard: true } });
  });

  // Шаг 2: Получение деталей (текст или файл)
  bot.on(['text', 'photo', 'document'], async (ctx) => {
    // 🛡️ ИГНОРИРУЕМ сообщения из групповых чатов и каналов
    if (ctx.chat?.type !== 'private') return;

    // 🛡️ Безопасная инициализация сессии
    ctx.session = ctx.session || {};
    const order = ctx.session.order;
    
    // Если заказа нет или мы не ждем детали, просто игнорируем сообщение
    if (!order || order.step !== 'waiting_details') return;

    // Сохраняем ID сообщения, чтобы потом переслать его менеджеру
    order.detailMessageId = ctx.message.message_id;
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
    summary += `Нажмите кнопку ниже для подтверждения и перехода к оплате.`;

    await ctx.reply(summary, createInlineKeyboard([
      [{ text: '💳 Подтвердить и оплатить', callback: 'order:confirm' }]
    ]));
  });

  // Шаг 3: Подтверждение и уведомление менеджеров
  bot.action('order:confirm', async (ctx) => {
    ctx.session = ctx.session || {};
    const order = ctx.session.order;
    
    if (!order) {
      return ctx.answerCbQuery('❌ Заказ не найден. Начните заново через /start');
    }

    const work = catalog.getWork(order.workId);
    const pricing = loyalty.calculatePrice(work.price, ctx.from.id);
    const managerChatId = process.env.MANAGER_CHAT_ID;

    // 1. Формируем текст для менеджера
    const userLink = `[${ctx.from.first_name || 'Пользователь'}](tg://user?id=${ctx.from.id})`;
    let managerMsg = `🔔 *НОВЫЙ ЗАКАЗ!*\n\n`;
    managerMsg += `👤 Заказчик: ${userLink} (ID: \`${ctx.from.id}\`)\n`;
    managerMsg += `📚 Работа: ${work.title}\n`;
    managerMsg += `💰 Сумма: ${pricing.finalPrice} ₽ (скидка ${pricing.discountPercent}%)\n`;
    managerMsg += `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

    try {
      // 2. Отправляем текст менеджеру
      await ctx.telegram.sendMessage(managerChatId, managerMsg, { parse_mode: 'Markdown' });

      // 3. Пересылаем сообщение с деталями/файлом от пользователя менеджеру
      if (order.detailMessageId) {
        await ctx.forwardMessage(managerChatId, ctx.chat.id, order.detailMessageId);
      }

      // 4. Очищаем сессию и благодарим пользователя
      ctx.session.order = null;
      await ctx.reply('✅ Спасибо! Ваш заказ принят и передан менеджерам. Мы свяжемся с вами для уточнения деталей оплаты в ближайшее время.', { reply_markup: { remove_keyboard: true } });
      
      // Уведомляем пользователя, что кнопка нажата (убираем часики загрузки)
      await ctx.answerCbQuery('✅ Заказ отправлен!');
    } catch (error) {
      console.error('Ошибка при отправке заказа менеджеру:', error);
      await ctx.reply('❌ Произошла ошибка при отправке заказа. Пожалуйста, напишите нам напрямую.');
    }
  });
}

module.exports = { register };