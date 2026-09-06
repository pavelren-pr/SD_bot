const { createInlineKeyboard } = require('../utils/keyboard');
const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');

function register(bot) {

  // 1. Показ курсов (с фильтрацией по специальности пользователя)
  bot.action('catalog:courses', (ctx) => {
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    
    if (!userSpecialty) {
      return ctx.answerCbQuery('❌ Сначала выберите специальность в меню');
    }
    
    const courses = catalog.getCourses(userSpecialty);
    
    if (!courses || courses.length === 0) {
      return ctx.answerCbQuery('📭 Для вашей специальности пока нет курсов');
    }
    
    const buttons = courses.map(c => [{ text: c.name, callback: `catalog:subject:${c.id}` }]);
    ctx.editMessageText('Выберите курс:', createInlineKeyboard(buttons));
  });

  // 2. Показ предметов выбранного курса
  bot.action(/^catalog:subject:(.+)$/, (ctx) => {
    const courseId = ctx.match[1];
    const course = catalog.getCourse(courseId);
    
    if (!course) {
      return ctx.answerCbQuery('❌ Курс не найден');
    }
    
    // Проверка: курс принадлежит специальности пользователя
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && course.specialty && course.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Этот курс не для вашей специальности');
    }
    
    const subjects = catalog.getSubjectsByCourse(courseId);
    
    if (!subjects || subjects.length === 0) {
      return ctx.answerCbQuery('📭 Для этого курса пока нет предметов');
    }
    
    const buttons = subjects.map(s => [{ text: s.name, callback: `catalog:work:${s.id}` }]);
    ctx.editMessageText(
      `📚 Курс: *${course.name}*\nВыберите предмет:`, 
      {
        parse_mode: 'Markdown',
        ...createInlineKeyboard(buttons, 'catalog:courses')
      }
    );
  });

  // 3. Показ работ выбранного предмета с информацией о курсе и предмете в заголовке
  bot.action(/^catalog:work:(.+)$/, (ctx) => {
    const subjectId = ctx.match[1];
    const subject = catalog.getSubject(subjectId);
    
    if (!subject) {
      return ctx.answerCbQuery('❌ Предмет не найден');
    }
    
    const course = catalog.getCourse(subject.courseId);
    
    // Проверка: предмет принадлежит специальности пользователя
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && course.specialty && course.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Этот предмет не для вашей специальности');
    }
    
    const works = catalog.getWorksBySubject(subjectId);
    
    if (!works || works.length === 0) {
      return ctx.answerCbQuery('📭 Для этого предмета пока нет работ');
    }
    
    // Заголовок с информацией о курсе и предмете
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
    
    if (!work) {
      return ctx.answerCbQuery('❌ Работа не найдена');
    }
    
    const subject = catalog.getSubject(work.subjectId);
    const course = catalog.getCourse(subject.courseId);
    
    // Проверка: работа принадлежит специальности пользователя
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && course.specialty && course.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Эта работа не для вашей специальности');
    }
    
    const pricing = require('../data/loyalty').calculatePrice(work.price, ctx.from.id);
    
    let text = `🎯 *${work.title}*\n\n`;
    
    // Безопасно показываем описание, если оно есть и не пустое
    if (work.description && work.description.trim() !== '') {
      text += `${work.description}\n\n`;
    }
    
    // Ссылка на примеры работ (если есть в каталоге)
    if (work.exampleUrl && work.exampleUrl.trim() !== '') {
      text += `🔍 *Пример работы и методички* [доступны по ссылке](${work.exampleUrl})\n\n`;
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