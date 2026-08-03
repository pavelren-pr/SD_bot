require('dotenv').config();
const bot = require('./bot');
const commands = require('./handlers/commands');
const catalog = require('./handlers/catalog');
const order = require('./handlers/order');

commands.register(bot);
catalog.register(bot);
order.register(bot);

bot.launch();
console.log('✅ Бот успешно запущен!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));