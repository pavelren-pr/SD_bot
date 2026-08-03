const { Telegraf, session } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => console.log('🧹 Старые подключения очищены'))
  .catch(err => console.warn('Не удалось очистить webhook:', err.message));

module.exports = bot;