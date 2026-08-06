const { Telegraf, session } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

// 🌟 Глобальный обработчик ошибок
bot.catch((err, ctx) => {
  console.error('❌ Глобальная ошибка:', err);
  
  // Пытаемся отправить пользователю красивое сообщение
  if (ctx && ctx.reply) {
    ctx.reply(
      '⚙️ *Технические работы*\n\n' +
      'Бот только что обновился и перезапустился. ' +
      'Чтобы продолжить работу, пожалуйста, нажмите кнопку /start или отправьте команду /start вручную.\n\n' +
      'Извините за неудобство! 🙏',
      { parse_mode: 'Markdown' }
    ).catch(() => {
      // Если не удалось отправить сообщение, просто логируем
      console.error('Не удалось отправить сообщение об ошибке пользователю');
    });
  }
});

module.exports = bot;