require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { logMessage, logButton, logError } = require('./utils/logger');

// 🌟 Условная логика прокси:
// Если в .env есть PROXY_URL — используем его (для локальной разработки через VPN)
// Если PROXY_URL нет — бот идёт напрямую (для сервера)
const telegramOptions = {};
if (process.env.PROXY_URL) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    console.log(`🌐 Запуск бота через прокси: ${process.env.PROXY_URL}`);
    telegramOptions.agent = new HttpsProxyAgent(process.env.PROXY_URL);
  } catch (e) {
    console.warn('⚠️ https-proxy-agent не установлен, запуск без прокси');
  }
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