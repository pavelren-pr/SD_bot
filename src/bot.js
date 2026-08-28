require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { logMessage, logButton, logError } = require('./utils/logger');

// 🌟 Прокси для обхода блокировки Telegram на VDS
// Используем публичный HTTPS прокси
const PROXY_URL = 'http://proxy.telegram-free.workers.dev:80';

const telegramOptions = {};
try {
  telegramOptions.agent = new HttpsProxyAgent(PROXY_URL);
  console.log(`🌐 Запуск бота через прокси: ${PROXY_URL}`);
} catch (e) {
  console.warn('⚠️ Не удалось создать прокси-агент:', e.message);
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: telegramOptions
});

bot.use(session());

// 🌟 Middleware: логируем все входящие сообщения
bot.use((ctx, next) => {
  if (ctx.message) logMessage(ctx);
  return next();
});

// 🌟 Middleware: логируем все нажатия кнопок
bot.use((ctx, next) => {
  if (ctx.callbackQuery) logButton(ctx);
  return next();
});

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

bot.catch((err, ctx) => {
  console.error('❌ Глобальная ошибка:', err);
  logError(err, ctx);
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