const { createInlineKeyboard } = require('../utils/keyboard');
const catalog = require('../data/catalog');

function register(bot) {
  // 1. Показ курсов
  bot.action('catalog:courses', (ctx) => {
    const buttons = catalog.courses.map(c => [{ text: c.name, callback: `catalog:subject:${c.id}` }]);
    ctx.editMessageText('Выберите курс:', createInlineKeyboard(buttons));
  });

  // 2. Показ предметов выбранного курса
  bot.action(/^catalog:subject:(.+)$/, (ctx) => {
    const courseId = ctx.match[1];
    const course = catalog.getCourse(courseId);
    const subjects = catalog.getSubjectsByCourse(courseId);

    const buttons = subjects.map(s => [{ text: s.name, callback: `catalog:work:${s.id}` }]);
    ctx.editMessageText(
      `📚 Курс: *${course.name}*\nВыберите предмет:`, 
      createInlineKeyboard(buttons, 'catalog:courses')
    );
  });

  // 3. Показ работ выбранного предмета
  bot.action(/^catalog:work:(.+)$/, (ctx) => {
    const subjectId = ctx.match[1];
    const works = catalog.getWorksBySubject(subjectId);

    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    ctx.editMessageText(
      'Выберите конкретную работу:', 
      createInlineKeyboard(buttons, `catalog:subject:${works[0]?.courseId || 'course1'}`) 
    );
  });

  // 4. Детали работы и кнопка заказа
  bot.action(/^catalog:details:(.+)$/, (ctx) => {
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);

    // 🌟 Умная кнопка "Назад": возвращает к списку работ этого же предмета
    const buttons = [
      [{ text: '✅ Оформить этот заказ', callback: `order:start:${workId}` }],
      [{ text: '⬅️ Назад к работам предмета', callback: `catalog:work:${work.subjectId}` }]
    ];

    ctx.editMessageText(
      `📝 *${work.title}*\n\n${work.description}\n\n💰 Стоимость: ${work.price} ₽`,
      createInlineKeyboard(buttons)
    );
  });
}

module.exports = { register };