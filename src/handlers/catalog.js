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
    
    let header = `📋 <b>Общие работы</b>\n`;
    header += `📝 <b>Выберите работу:</b>`;
    
    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    ctx.editMessageText(
      header,
      {
        parse_mode: 'HTML',
        ...createInlineKeyboard(buttons, 'catalog:courses')
      }
    );
  });

  // 2. Показ предметов выбранного курса
  bot.action(/^catalog:subject:(.+)$/, (ctx) => {
    const courseId = ctx.match[1];
    const course = catalog.getCourse(courseId);
    if (!course) return ctx.answerCbQuery('❌ Курс не найден');
    
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && course.specialty && course.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Этот курс не для вашей специальности');
    }
    
    const subjects = catalog.getSubjectsByCourse(courseId);
    const generalWorks = catalog.getWorksByCourse(courseId);
    
    const buttons = subjects.map(s => [{ text: s.name, callback: `catalog:work:${s.id}` }]);
    
    // 🌟 Добавляем пункт "Общие работы" если они есть
    if (generalWorks.length > 0) {
      buttons.push([{ text: `📋 Общие работы`, callback: `catalog:course_general:${courseId}` }]);
    }
    
    if (buttons.length === 0) {
      return ctx.answerCbQuery('📭 Для этого курса пока нет предметов и работ');
    }
    
    ctx.editMessageText(
      `📚 Курс: <b>${course.name}</b>\nВыберите предмет:`,
      {
        parse_mode: 'HTML',
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
    let header = `🎯 <b>Выбран: ${course.name}</b>\n`;
    header += `📖 <b>Предмет:</b> ${subject.name}\n\n`;
    header += `📝 <b>Выберите работу:</b>`;
    
    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    ctx.editMessageText(
      header, 
      {
        parse_mode: 'HTML',
        ...createInlineKeyboard(buttons, `catalog:subject:${subject.courseId}`)
      }
    );
  });

  // 🌟 Показ общих работ курса (без предмета)
  bot.action(/^catalog:course_general:(.+)$/, (ctx) => {
    const courseId = ctx.match[1];
    const course = catalog.getCourse(courseId);
    if (!course) return ctx.answerCbQuery('❌ Курс не найден');
    
    const userSpecialty = loyalty.getUserSpecialty(ctx.from.id);
    if (userSpecialty && course.specialty && course.specialty !== userSpecialty) {
      return ctx.answerCbQuery('❌ Этот курс не для вашей специальности');
    }
    
    const works = catalog.getWorksByCourse(courseId);
    if (!works || works.length === 0) {
      return ctx.answerCbQuery('📭 Для этого курса пока нет общих работ');
    }
    
    let header = `📋 <b>Общие работы</b>\n`;
    header += `📚 Курс: <b>${course.name}</b>\n\n`;
    header += `📝 <b>Выберите работу:</b>`;
    
    const buttons = works.map(w => [{ text: w.title, callback: `catalog:details:${w.id}` }]);
    ctx.editMessageText(
      header,
      {
        parse_mode: 'HTML',
        ...createInlineKeyboard(buttons, `catalog:subject:${courseId}`)
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
    
    let text = `🎯 <b>${work.title}</b>\n\n`;
    if (work.description && work.description.trim() !== '') {
      text += `${work.description}\n\n`;
    }
    if (work.exampleUrl && work.exampleUrl.trim() !== '') {
      text += `🔍 <b>Пример работы и методички</b> <a href="${work.exampleUrl}">доступны по ссылке</a>\n\n`;
    }
    text += `💰 <b>Стоимость:</b> ${work.price} ₽\n`;
    if (pricing.discountPercent > 0) {
      text += `🎉 <b>Ваша скидка:</b> ${pricing.discountPercent}%\n`;
    }
    text += `✅ <b>Итого к оплате:</b> ${pricing.finalPrice} ₽\n\n`;
    text += `📌 <b>Что нужно для заказа:</b>\n${work.prompt}`;
    
    // 🌟 Кнопка "Назад" зависит от типа работы
    let backCallback;
    if (work.subjectId) {
      backCallback = `catalog:work:${work.subjectId}`;
    } else if (work.courseId) {
      backCallback = `catalog:course_general:${work.courseId}`;
    } else {
      backCallback = 'catalog:general_works';
    }

    const buttons = [
      [{ text: '✅ Оформить этот заказ', callback: `order:start:${workId}` }],
      [{ text: '⬅️ Назад', callback: backCallback }]
    ];
    
    await ctx.editMessageText(
      text,
      {
        parse_mode: 'HTML',
        ...require('../utils/keyboard').createInlineKeyboard(buttons)
      }
    );
  });
}

module.exports = { register };