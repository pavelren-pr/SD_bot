const { createInlineKeyboard } = require('../utils/keyboard');
const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');

function register(bot) {

  // 1. Показ курсов + общие работы
  bot.action('catalog:courses', (ctx) => {
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (!userSpecialty) {
      return ctx.answerCbQuery('❌ Сначала выберите специальность в меню');
    }
    const courses = catalog.getCourses(userSpecialty);
    const generalWorks = catalog.getWorksBySpecialty(userSpecialty);
    
    const buttons = courses.map(c => [{ text: c.name, callback: `catalog:subject:${c.id}` }]);
    
    // 🌟 Добавляем пункт "Общие работы" если они есть
    if (generalWorks.length > 0) {
      buttons.push([{ text: `📋 Общие работы`, callback: `catalog:general_works` }]);
    }
    
    if (buttons.length === 0) {
      return ctx.answerCbQuery('📭 Для вашей специальности пока нет курсов и работ');
    }
    
    ctx.editMessageText('Выберите курс:', createInlineKeyboard(buttons));
  });

  // 🌟 Показ общих работ (без курса/предмета)
  bot.action('catalog:general_works', (ctx) => {
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (!userSpecialty) {
      return ctx.answerCbQuery('❌ Сначала выберите специальность в меню');
    }
    const works = catalog.getWorksBySpecialty(userSpecialty);
    if (!works || works.length === 0) {
      return ctx.answerCbQuery('📭 Для вашей специальности пока нет общих работ');
    }
    
    let header = `📋 *Общие работы*\n`;
    header += `📝 *Выберите работу:*`;
    
    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    ctx.editMessageText(
      header,
      {
        parse_mode: 'Markdown',
        ...createInlineKeyboard(buttons, 'catalog:courses')
      }
    );
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
    
    // 🌟 Проверка специальности
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && work.specialty && work.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Эта работа не для вашей специальности');
    }
    
    // 🌟 Безопасное получение курса (для общих работ курс/предмет отсутствуют)
    if (work.subjectId) {
      const subject = catalog.getSubject(work.subjectId);
      if (subject) {
        const course = catalog.getCourse(subject.courseId);
        if (userSpecialty && course && course.specialty && course.specialty !== userSpecialty) {
          return ctx.answerCbQuery('❌ Эта работа не для вашей специальности');
        }
      }
    }
    
    const pricing = require('../data/loyalty').calculatePrice(work.price, ctx.from.id);
    
    let text = `🎯 *${work.title}*\n\n`;
    if (work.description && work.description.trim() !== '') {
      text += `${work.description}\n\n`;
    }
    if (work.exampleUrl && work.exampleUrl.trim() !== '') {
      text += `🔍 *Пример работы и методички* [доступны по ссылке](${work.exampleUrl})\n\n`;
    }
    text += `💰 *Стоимость:* ${work.price} ₽\n`;
    if (pricing.discountPercent > 0) {
      text += `🎉 *Ваша скидка:* ${pricing.discountPercent}%\n`;
    }
    text += `✅ *Итого к оплате:* ${pricing.finalPrice} ₽\n\n`;
    text += `📌 *Что нужно для заказа:*\n${work.prompt}`;
    
    // 🌟 Кнопка "Назад" — зависит от типа работы
    const backCallback = work.subjectId ? `catalog:work:${work.subjectId}` : 'catalog:general_works';
    
    const buttons = [
      [{ text: '✅ Оформить этот заказ', callback: `order:start:${workId}` }],
      [{ text: '⬅️ Назад', callback: backCallback }]
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