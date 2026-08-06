const catalog = require('../data/catalog');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');

const ADMIN_PASSWORD = process.env.EDIT_PASSWORD;

function register(bot) {
  // 1. Вход в админ-панель по паролю
  bot.on('text', async (ctx) => {
    if (ctx.message.text === ADMIN_PASSWORD) {
      ctx.session.adminState = 'main_menu';
      await ctx.reply('🔐 *Доступ разрешен. Добро пожаловать в панель управления.*', { 
        parse_mode: 'Markdown',
        reply_markup: getAdminMainMenu()
      });
      return;
    }

    // Обработка состояний админ-панели
    const state = ctx.session.adminState;
    if (!state) return;

    // --- ДОБАВЛЕНИЕ РАБОТЫ (Пошагово) ---
    if (state.startsWith('add_work_')) {
      await handleAddWorkStep(ctx, state);
      return;
    }

    // --- ИЗМЕНЕНИЕ РАБОТЫ ---
    if (state.startsWith('edit_work_field_')) {
      await handleEditWorkStep(ctx, state);
      return;
    }
  });

  // 2. Навигация админ-панели
  bot.action(/^admin:(.+)$/, async (ctx) => {
    const action = ctx.match[1];

    if (action === 'main') {
      ctx.session.adminState = 'main_menu';
      await ctx.editMessageText('🛠 *Панель управления каталогом*', { parse_mode: 'Markdown', reply_markup: getAdminMainMenu() });
    } 
    else if (action === 'add_course') {
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ *Введите название нового курса:*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (action === 'add_subject') {
      ctx.session.adminState = 'awaiting_subject_course';
      await ctx.editMessageText('📚 *Выберите курс для нового предмета:*', { parse_mode: 'Markdown', reply_markup: getCourseSelectionKeyboard('admin:add_subject_confirm:') });
    }
    else if (action === 'add_work') {
      ctx.session.adminState = 'add_work_course';
      await ctx.editMessageText('📝 *Добавление новой работы. Шаг 1/8: Выберите курс:*', { parse_mode: 'Markdown', reply_markup: getCourseSelectionKeyboard('admin:add_work_subject:') });
    }
    else if (action === 'edit_work') {
      ctx.session.adminState = 'edit_work_select';
      await ctx.editMessageText('✏️ *Изменение работы. Выберите работу из списка:*', { parse_mode: 'Markdown', reply_markup: getWorkSelectionKeyboard() });
    }
    else if (action.startsWith('add_subject_confirm:')) {
      const courseId = action.split(':')[2];
      ctx.session.tempSubjectCourseId = courseId;
      ctx.session.adminState = 'awaiting_subject_name';
      await ctx.editMessageText(`✏️ *Введите название предмета для курса ID: ${courseId}*`, { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (action.startsWith('admin:add_work_subject:')) {
      const courseId = action.split(':')[3];
      ctx.session.tempWorkCourseId = courseId;
      ctx.session.adminState = 'add_work_subject_select';
      await ctx.editMessageText(`📝 *Шаг 2/8: Выберите предмет:*`, { parse_mode: 'Markdown', reply_markup: getSubjectSelectionKeyboard(courseId, 'admin:add_work_start:') });
    }
    else if (action.startsWith('admin:add_work_start:')) {
      const subjectId = action.split(':')[3];
      ctx.session.tempWorkSubjectId = subjectId;
      ctx.session.tempWorkData = { courseId: ctx.session.tempWorkCourseId, subjectId };
      ctx.session.adminState = 'add_work_title';
      await ctx.editMessageText(`📝 *Шаг 3/8: Введите название работы:*`, { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_work_select:')) {
      const workId = action.split(':')[2];
      ctx.session.editingWorkId = workId;
      ctx.session.adminState = 'edit_work_field_select';
      const work = catalog.getWork(workId);
      await ctx.editMessageText(`✏️ *Редактирование: ${work.title}*\n\nВыберите поле для изменения:`, { parse_mode: 'Markdown', reply_markup: getEditWorkFieldsKeyboard() });
    }
    else if (action.startsWith('edit_work_field:')) {
      const field = action.split(':')[2];
      ctx.session.adminState = `edit_work_field_${field}`;
      await ctx.editMessageText(`✏️ *Введите новое значение для поля "${field}":*`, { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    
    await ctx.answerCbQuery();
  });

  // --- ОБРАБОТЧИКИ ШАГОВ ДОБАВЛЕНИЯ РАБОТЫ ---
  async function handleAddWorkStep(ctx, state) {
    const text = ctx.message.text;
    const data = ctx.session.tempWorkData || {};

    if (state === 'awaiting_course_name') {
      const courses = catalog.getData().courses;
      const newId = `course${courses.length + 1}`;
      courses.push({ id: newId, name: text });
      catalog.saveData({ ...catalog.getData(), courses });
      await ctx.reply(`✅ Курс добавлен! ID: ${newId}`, { reply_markup: getBackToAdminMenu() });
      ctx.session.adminState = 'main_menu';
    } 
    else if (state === 'awaiting_subject_name') {
      const subjects = catalog.getData().subjects;
      const newId = `subj${Date.now()}`;
      subjects.push({ id: newId, courseId: ctx.session.tempSubjectCourseId, name: text });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ Предмет добавлен! ID: ${newId}`, { reply_markup: getBackToAdminMenu() });
      ctx.session.adminState = 'main_menu';
    }
    else if (state === 'add_work_title') {
      data.title = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_price';
      await ctx.reply('📝 *Шаг 4/8: Введите цену (только число, например 1500):*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_price') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом. Попробуйте еще раз:');
      data.price = parseInt(text);
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_commission';
      await ctx.reply('📝 *Шаг 5/8: Введите комиссию в % (например, 20):*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_commission') {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом. Попробуйте еще раз:');
      data.commission = parseInt(text);
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_chatEnv';
      await ctx.reply('📝 *Шаг 6/8: Введите имя переменной окружения для чата (например, MY_CHAT_ID или CHERCHENIE_CHAT_ID):*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_chatEnv') {
      data.chatEnv = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_paymentEnv';
      await ctx.reply('📝 *Шаг 7/8: Введите имя переменной окружения для оплаты (например, MY_CARD_NUMBER):*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_paymentEnv') {
      data.paymentEnv = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_needs';
      await ctx.reply('📝 *Шаг 8/8: Что требуется от пользователя? Введите через запятую: photo, details, variant. Или введите "нет":*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_needs') {
      data.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_prompt';
      await ctx.reply('📝 *Финальный шаг: Введите текст подсказки (prompt), который бот покажет пользователю:*', { parse_mode: 'Markdown', reply_markup: getBackToAdminMenu() });
    }
    else if (state === 'add_work_prompt') {
      data.prompt = text;
      data.id = `work_${Date.now()}`; // Генерируем уникальный ID
      
      const works = catalog.getData().works;
      works.push(data);
      catalog.saveData({ ...catalog.getData(), works });
      
      await ctx.reply(`✅ *Работа успешно добавлена!*\n\nID: ${data.id}\nНазвание: ${data.title}\nЦена: ${data.price} ₽`, { 
        parse_mode: 'Markdown',
        reply_markup: getBackToAdminMenu()
      });
      ctx.session.adminState = 'main_menu';
      ctx.session.tempWorkData = null;
    }
  }

  // --- ОБРАБОТЧИКИ ИЗМЕНЕНИЯ РАБОТЫ ---
  async function handleEditWorkStep(ctx, state) {
    const text = ctx.message.text;
    const workId = ctx.session.editingWorkId;
    const data = catalog.getData();
    const workIndex = data.works.findIndex(w => w.id === workId);
    
    if (workIndex === -1) return ctx.reply('❌ Работа не найдена.');

    const field = state.replace('edit_work_field_', '');
    let value = text;

    // Валидация для числовых полей
    if ((field === 'price' || field === 'commission') && isNaN(text)) {
      return ctx.reply('❌ Значение должно быть числом. Попробуйте еще раз:');
    }
    if (field === 'price' || field === 'commission') value = parseInt(text);
    if (field === 'needs') value = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());

    data.works[workIndex][field] = value;
    catalog.saveData(data);

    await ctx.reply(`✅ Поле "${field}" успешно обновлено!`, { reply_markup: getBackToAdminMenu() });
    ctx.session.adminState = 'main_menu';
    ctx.session.editingWorkId = null;
  }

  // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КЛАВИАТУР ---
  function getAdminMainMenu() {
    return Markup.inlineKeyboard([
      [{ text: '📚 Курсы', callback: 'admin:courses' }, { text: '➕ Добавить курс', callback: 'admin:add_course' }],
      [{ text: '📖 Предметы', callback: 'admin:subjects' }, { text: '➕ Добавить предмет', callback: 'admin:add_subject' }],
      [{ text: '📝 Работы', callback: 'admin:works' }, { text: '➕ Добавить работу', callback: 'admin:add_work' }],
      [{ text: '✏️ Изменить работу', callback: 'admin:edit_work' }],
      [{ text: '❌ Закрыть панель', callback: 'admin:close' }]
    ]);
  }

  function getBackToAdminMenu() {
    return Markup.inlineKeyboard([
      [{ text: '⬅️ Назад в меню', callback: 'admin:main' }]
    ]);
  }

  function getCourseSelectionKeyboard(prefix) {
    const buttons = catalog.courses.map(c => [{ text: c.name, callback: `${prefix}${c.id}` }]);
    buttons.push([{ text: '⬅️ Назад', callback: 'admin:main' }]);
    return Markup.inlineKeyboard(buttons);
  }

  function getSubjectSelectionKeyboard(courseId, prefix) {
    const subjects = catalog.getSubjectsByCourse(courseId);
    const buttons = subjects.map(s => [{ text: s.name, callback: `${prefix}${s.id}` }]);
    buttons.push([{ text: '⬅️ Назад', callback: 'admin:main' }]);
    return Markup.inlineKeyboard(buttons);
  }

  function getWorkSelectionKeyboard() {
    // Показываем последние 10 работ, чтобы не перегружать экран
    const recentWorks = catalog.works.slice(-10).reverse();
    const buttons = recentWorks.map(w => [{ text: w.title.substring(0, 40) + '...', callback: `edit_work_select:${w.id}` }]);
    buttons.push([{ text: '⬅️ Назад', callback: 'admin:main' }]);
    return Markup.inlineKeyboard(buttons);
  }

  function getEditWorkFieldsKeyboard() {
    return Markup.inlineKeyboard([
      [{ text: 'Название', callback: 'edit_work_field:title' }],
      [{ text: 'Цена', callback: 'edit_work_field:price' }],
      [{ text: 'Комиссия', callback: 'edit_work_field:commission' }],
      [{ text: 'Чат (env)', callback: 'edit_work_field:chatEnv' }],
      [{ text: 'Оплата (env)', callback: 'edit_work_field:paymentEnv' }],
      [{ text: 'Требования (needs)', callback: 'edit_work_field:needs' }],
      [{ text: 'Подсказка (prompt)', callback: 'edit_work_field:prompt' }],
      [{ text: '⬅️ Назад', callback: 'admin:edit_work' }]
    ]);
  }
}

module.exports = { register };