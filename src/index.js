require('dotenv').config();
const bot = require('./bot');
const { logSystemEvent } = require('./utils/logger');

const menu = require('./handlers/menu');
const commands = require('./handlers/commands');
const catalog = require('./handlers/catalog');
const order = require('./handlers/order');
const admin = require('./handlers/admin');
const treasure = require('./handlers/treasure');
const customOrder = require('./handlers/custom_order');

menu.register(bot);
commands.register(bot);
catalog.register(bot);
customOrder.register(bot);
order.register(bot);
admin.register(bot);
treasure.register(bot);

bot.launch();
console.log('✅ Бот успешно запущен!');
logSystemEvent('bot_started', { pid: process.pid });

process.once('SIGINT', () => {
  logSystemEvent('bot_stopped', { signal: 'SIGINT' });
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  logSystemEvent('bot_stopped', { signal: 'SIGTERM' });
  bot.stop('SIGTERM');
});

process.on('uncaughtException', (err) => {
  logSystemEvent('uncaught_exception', { message: err.message, stack: err.stack });
  console.error('💥 Необработанное исключение:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logSystemEvent('unhandled_rejection', { reason: String(reason) });
  console.error('💥 Необработанный промис:', reason);
});