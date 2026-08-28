require('dotenv').config();
const { Telegraf, session } = require('telegraf');

// 🌟 Настройка Telegram API
const telegramOptions = {};

// Если указан TELEGRAM_API_ROOT (для Cloudflare Worker на сервере)
if (process.env.TELEGRAM_API_ROOT) {
  console.log(`🌐 Запуск бота через API Root: ${process.env.TELEGRAM_API_ROOT}`);
  telegramOptions.apiRoot = process.env.TELEGRAM_API_ROOT;
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: telegramOptions
});

bot.use(session());

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

// 🌟 Глобальный обработчик ошибок
bot.catch((err, ctx) => {
  console.error('❌ Глобальная ошибка:', err);
  if (ctx && ctx.reply) {
    ctx.reply(
      '⚙️ Технические работы\n\n' +
      'Бот только что обновился и перезапустился. ' +
      'Чтобы продолжить работу, нажмите /start.\n\n' +
      'Извините за неудобство! 🙏',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

module.exports = bot;