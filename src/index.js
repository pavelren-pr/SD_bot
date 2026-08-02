require('dotenv').config();
const bot = require('./bot');
const commands = require('./handlers/commands');
const catalog = require('./handlers/catalog');
const order = require('./handlers/order');

// Регистрируем обработчики
commands.register(bot);
catalog.register(bot);
order.register(bot);

// Запуск бота
bot.launch();
console.log('✅ Бот успешно запущен!');

// Корректное завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));