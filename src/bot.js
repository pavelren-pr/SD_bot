const { Telegraf, session } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Включаем сессии для хранения состояния заказа
bot.use(session());

// 🛡️ Защита от ошибки 409: удаляем webhook и старые подключения при старте
bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

module.exports = bot;