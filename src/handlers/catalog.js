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

  // 3. Показ работ выбранного предмета с информацией о курсе и предмете в заголовке
  bot.action(/^catalog:work:(.+)$/, (ctx) => {
    const subjectId = ctx.match[1];
    const subject = catalog.getSubject(subjectId);
    const course = catalog.getCourse(subject.courseId);
    const works = catalog.getWorksBySubject(subjectId);

    // 🌟 Заголовок с информацией о курсе и предмете
    let header = `🎯 *Выбран: ${course.name}*\n`;
    header += `📖 *Предмет:* ${subject.name}\n\n`;
    header += `📝 *Выберите работу:*`;

    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    
    ctx.editMessageText(
      header, 
      {
        parse_mode: 'Markdown',
        ...createInlineKeyboard(buttons, `catalog:subject:${subject.courseId}`)
      }
    );
  });

      // 4. Детали работы и кнопка заказа
  bot.action(/^catalog:details:(.+)$/, async (ctx) => {
    const workId = ctx.match[1];
    const work = catalog.getWork(workId);
    const subject = catalog.getSubject(work.subjectId);
    const course = catalog.getCourse(subject.courseId);
    const pricing = require('../data/loyalty').calculatePrice(work.price, ctx.from.id);

    let text = `🎯 *${work.title}*\n\n`;
    
    // 🌟 Безопасно показываем описание, если оно есть и не пустое
    if (work.description && work.description.trim() !== '') {
      text += `${work.description}\n\n`;
    }
    
    text += `💰 *Стоимость:* ${work.price} ₽\n`;
    if (pricing.discountPercent > 0) {
      text += `🎉 *Ваша скидка:* ${pricing.discountPercent}%\n`;
    }
    text += `✅ *Итого к оплате:* ${pricing.finalPrice} ₽\n\n`;
    text += `📌 *Что нужно для заказа:*\n${work.prompt}`;

    const buttons = [
      [{ text: '✅ Оформить этот заказ', callback: `order:start:${workId}` }],
      [{ text: '⬅️ Назад к работам предмета', callback: `catalog:work:${work.subjectId}` }]
    ];

    await ctx.editMessageText(
      text,
      {
        parse_mode: 'Markdown',
        ...require('../utils/keyboard').createInlineKeyboard(buttons)
      }
    );
  });
}

module.exports = { register };