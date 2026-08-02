const { Telegraf, session } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Включаем сессии для хранения состояния заказа (ctx.session)
bot.use(session());

module.exports = bot;