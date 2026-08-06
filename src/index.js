require('dotenv').config();
const bot = require('./bot');

// 🌟 1. Сначала регистрируем меню и команды (чтобы они перехватывали /start первыми)
const menu = require('./handlers/menu');
const commands = require('./handlers/commands');

// 🌟 2. Затем остальную логику
const catalog = require('./handlers/catalog');
const order = require('./handlers/order');
const admin = require('./handlers/admin');
const treasure = require('./handlers/treasure');

// Регистрируем обработчики в правильном порядке:
menu.register(bot);
commands.register(bot);
catalog.register(bot);
order.register(bot);
admin.register(bot);
treasure.register(bot);

// Запуск бота
bot.launch();
console.log('✅ Бот успешно запущен!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));