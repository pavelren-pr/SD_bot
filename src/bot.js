require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { logMessage, logButton, logError } = require('./utils/logger');

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

// 🌟 Middleware: логируем все входящие сообщения
bot.use((ctx, next) => {
  if (ctx.message) {
    logMessage(ctx);
  }
  return next();
});

// 🌟 Middleware: логируем все нажатия кнопок
bot.use((ctx, next) => {
  if (ctx.callbackQuery) {
    logButton(ctx);
  }
  return next();
});

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

// 🌟 Глобальный обработчик ошибок (с логированием)
bot.catch((err, ctx) => {
  console.error('❌ Глобальная ошибка:', err);
  logError(err, ctx);

  if (ctx && ctx.reply) {
    ctx.reply(
      '⚙️ Технические работы\n\n' +
      'Бот только что обновился и перезапустился. ' +
      'Чтобы продолжить работу, пожалуйста, нажмите кнопку /start или отправьте команду /start вручную.\n\n' +
      'Извините за неудобство! 🙏',
      { parse_mode: 'Markdown' }
    ).catch(() => {
      console.error('Не удалось отправить сообщение об ошибке пользователю');
    });
  }
});

module.exports = bot;