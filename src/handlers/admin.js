const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// ==========================================
// Проверка прав (только Посейдон)
// ==========================================
function isAdmin(userId) {
  const info = loyalty.getLoyaltyInfo(userId);
  return info.hasFullAccess;
}

// ==========================================
// Клавиатуры
// ==========================================

function getAdminMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🗂 Управление каталогом', 'admin:catalog')],
    [Markup.button.callback('🏅 Изменить ранг пользователя', 'admin:set_user_rank')],
    [Markup.button.callback('❌ Закрыть панель', 'admin:close')]
  ]);
}

function getBackToAdminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
  ]);
}

// 🌟 Список курсов с админ-кнопками
function getCatalogMainMenu() {
  const buttons = catalog.courses.map(c =>
    [Markup.button.callback(c.name, `admin:catalog_course:${c.id}`)]
  );
  buttons.push([Markup.button.callback('➕ Добавить курс', 'admin:add_course')]);
  buttons.push([Markup.button.callback('✏️ Изменить курс', 'admin:edit_course')]); // 🌟 НОВОЕ
  buttons.push([Markup.button.callback('🗑 Удалить курс', 'admin:delete_course')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Предметы курса с админ-кнопками
function getCourseSubjects(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  
  const buttons = subjects.map(s =>
    [Markup.button.callback(s.name, `admin:catalog_subject:${s.id}`)]
  );
  buttons.push([Markup.button.callback('➕ Добавить предмет', `admin:add_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('✏️ Изменить предмет', `admin:edit_subject:${courseId}`)]); // 🌟 НОВОЕ
  buttons.push([Markup.button.callback('🗑 Удалить предмет', `admin:delete_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Работы предмета с админ-кнопками
function getSubjectWorks(subjectId) {
  const subject = catalog.getSubject(subjectId);
  const works = catalog.getWorksBySubject(subjectId);
  
  const buttons = works.map(w =>
    [Markup.button.callback(w.title.substring(0, 45), `admin:catalog_work:${w.id}`)]
  );
  buttons.push([Markup.button.callback('➕ Добавить работу', `admin:add_work:${subjectId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить работу', `admin:delete_work:${subjectId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_course:${subject.courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Карточка работы с кнопками редактирования
// 🌟 Карточка работы с кнопками редактирования
function getWorkCard(workId) {
  const work = catalog.getWork(workId);
  const subject = catalog.getSubject(work.subjectId);
  const course = catalog.getCourse(subject.courseId);
  
  let text = `✏️ *Редактирование работы*\n\n`;
  text += `📚 *Курс:* ${course.name}\n`;
  text += `📖 *Предмет:* ${subject.name}\n\n`;
  text += `📝 *Название:* ${work.title}\n`;
  
  // 🌟 Добавляем описание, если оно существует
  if (work.description && work.description.trim() !== '') {
    text += `📄 *Описание:* ${work.description}\n`;
  }
  
  text += `💰 *Цена:* ${work.price} ₽\n`;
  text += `📊 *Комиссия:* ${work.commission}%\n`;
  text += `💳 *Оплата:* \`${work.paymentEnv}\`\n`;
  text += `💬 *Чат:* \`${work.chatEnv}\`\n`;
  text += `📋 *Требования:* ${work.needs.join(', ') || 'нет'}\n\n`;
  text += `📌 *Подсказка:*\n${work.prompt}`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить информацию', `admin:edit_work:${workId}`)],
    [Markup.button.callback('⬅️ Назад', `admin:catalog_subject:${work.subjectId}`)]
  ]);
  
  return { text, keyboard };
}

// 🌟 Список курсов для удаления
function getDeleteCourseList() {
  const buttons = catalog.courses.map(c =>
    [Markup.button.callback(`🗑 ${c.name}`, `admin:delete_course_confirm:${c.id}`)]
  );
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Список предметов для удаления
function getDeleteSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s =>
    [Markup.button.callback(`🗑 ${s.name}`, `admin:delete_subject_confirm:${s.id}`)]
  );
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Список работ для удаления
function getDeleteWorkList(subjectId) {
  const works = catalog.getWorksBySubject(subjectId);
  const buttons = works.map(w =>
    [Markup.button.callback(`🗑 ${w.title.substring(0, 40)}`, `admin:delete_work_confirm:${w.id}`)]
  );
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_subject:${subjectId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Список курсов для ИЗМЕНЕНИЯ названия
function getEditCourseList() {
  const buttons = catalog.courses.map(c =>
    [Markup.button.callback(`✏️ ${c.name}`, `admin:edit_course_select:${c.id}`)]
  );
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

// 🌟 Список предметов для ИЗМЕНЕНИЯ названия (в конкретном курсе)
function getEditSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s =>
    [Markup.button.callback(`✏️ ${s.name}`, `admin:edit_subject_select:${s.id}`)]
  );
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// ==========================================
// Функция показа админ-меню из других модулей
// ==========================================
async function showAdminMenu(ctx) {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    return;
  }
  ctx.session = ctx.session || {};
  ctx.session.adminState = null;
  await ctx.reply('🛠 *Панель управления*', {
    parse_mode: 'Markdown',
    ...getAdminMainMenu()
  });
}

// ==========================================
// Регистрация обработчиков
// ==========================================
function register(bot) {
  // Команда /admin
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    }
    ctx.session = ctx.session || {};
    ctx.session.adminState = null;
    await ctx.reply('🛠 *Панель управления*', {
      parse_mode: 'Markdown',
      ...getAdminMainMenu()
    });
  });

  // ==========================================
  // Обработчик текстовых сообщений
  // ==========================================
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    
    // Если не в админ-панели — пропускаем
    if (!ctx.session.adminState) {
      await next();
      return;
    }
    
    if (!isAdmin(ctx.from.id)) return;
    
    const state = ctx.session.adminState;
    const text = ctx.message.text;
    
    console.log('⚙️ admin.js состояние:', state, 'текст:', text.substring(0, 30));

    // === ДОБАВЛЕНИЕ КУРСА ===
    if (state === 'awaiting_course_name') {
      const courses = catalog.getData().courses;
      const newId = `course${Date.now()}`;
      courses.push({ id: newId, name: text });
      catalog.saveData({ ...catalog.getData(), courses });
      await ctx.reply(`✅ Курс добавлен!\n\n*Название:* ${text}\n*ID:* \`${newId}\``, {
        parse_mode: 'Markdown',
        ...getCatalogMainMenu()
      });
      ctx.session.adminState = null;
      return;
    }

    // === ДОБАВЛЕНИЕ ПРЕДМЕТА ===
    if (state.startsWith('awaiting_subject_name:')) {
      const courseId = state.split(':')[1];
      const subjects = catalog.getData().subjects;
      const newId = `subj${Date.now()}`;
      subjects.push({ id: newId, courseId, name: text });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ Предмет добавлен!\n\n*Название:* ${text}`, {
        parse_mode: 'Markdown',
        ...getCourseSubjects(courseId)
      });
      ctx.session.adminState = null;
      return;
    }

    // === ИЗМЕНЕНИЕ НАЗВАНИЯ КУРСА ===
    if (state.startsWith('edit_course_name:')) {
      const courseId = state.split(':')[1];
      const data = catalog.getData();
      const courseIndex = data.courses.findIndex(c => c.id === courseId);
      
      if (courseIndex === -1) {
        await ctx.reply('❌ Курс не найден.', ...getCatalogMainMenu());
        ctx.session.adminState = null;
        return;
      }
      
      const oldName = data.courses[courseIndex].name;
      data.courses[courseIndex].name = text;
      catalog.saveData(data);
      
      await ctx.reply(`✅ Название курса изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, {
        parse_mode: 'Markdown',
        ...getCatalogMainMenu()
      });
      ctx.session.adminState = null;
      return;
    }

    // === ИЗМЕНЕНИЕ НАЗВАНИЯ ПРЕДМЕТА ===
    if (state.startsWith('edit_subject_name:')) {
      const subjectId = state.split(':')[1];
      const data = catalog.getData();
      const subjectIndex = data.subjects.findIndex(s => s.id === subjectId);
      
      if (subjectIndex === -1) {
        await ctx.reply('❌ Предмет не найден.');
        ctx.session.adminState = null;
        return;
      }
      
      const oldName = data.subjects[subjectIndex].name;
      const courseId = data.subjects[subjectIndex].courseId;
      data.subjects[subjectIndex].name = text;
      catalog.saveData(data);
      
      await ctx.reply(`✅ Название предмета изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, {
        parse_mode: 'Markdown',
        ...getCourseSubjects(courseId)
      });
      ctx.session.adminState = null;
      return;
    }

    // === ДОБАВЛЕНИЕ РАБОТЫ ===
    if (state.startsWith('add_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text };
      ctx.session.adminState = `add_work_price:${subjectId}`;
      await ctx.reply('📝 *Шаг 2/6: Введите цену (только число):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_price:')) {
      const subjectId = state.split(':')[1];
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом. Попробуйте еще раз:');
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_work_commission:${subjectId}`;
      await ctx.reply('📝 *Шаг 3/6: Введите комиссию в % (например, 20):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_commission:')) {
      const subjectId = state.split(':')[1];
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом. Попробуйте еще раз:');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_work_chatEnv:${subjectId}`;
      await ctx.reply('📝 *Шаг 4/6: Имя переменной окружения для чата (например, MY_CHAT_ID):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_chatEnv:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_work_paymentEnv:${subjectId}`;
      await ctx.reply('📝 *Шаг 5/6: Имя переменной окружения для оплаты (например, MY_CARD_NUMBER):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_paymentEnv:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_work_needs:${subjectId}`;
      await ctx.reply('📝 *Шаг 6/6: Требования через запятую (photo, details, variant) или "нет":*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_needs:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_work_prompt:${subjectId}`;
      await ctx.reply('📝 *Финальный шаг: Введите текст подсказки (prompt):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state.startsWith('add_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      
      const work = ctx.session.tempWorkData;
      await ctx.reply(`✅ *Работа добавлена!*\n\n📝 *${work.title}*\n💰 ${work.price} ₽`, {
        parse_mode: 'Markdown',
        ...getSubjectWorks(subjectId)
      });
      ctx.session.adminState = null;
      ctx.session.tempWorkData = null;
      return;
    }

    // === РЕДАКТИРОВАНИЕ РАБОТЫ ===
    if (state.startsWith('edit_work_input:')) {
      const parts = state.split(':');
      const workId = parts[1];
      const field = parts[2];
      const data = catalog.getData();
      const workIndex = data.works.findIndex(w => w.id === workId);
      
      if (workIndex === -1) return ctx.reply('❌ Работа не найдена.');
      
      let value = text;
      if ((field === 'price' || field === 'commission') && isNaN(text)) {
        return ctx.reply('❌ Значение должно быть числом. Попробуйте еще раз:');
      }
      if (field === 'price' || field === 'commission') value = parseInt(text);
      
      data.works[workIndex][field] = value;
      catalog.saveData(data);
      
      const work = catalog.getWork(workId);
      await ctx.reply(`✅ Поле "${field}" обновлено!\n\n📝 *${work.title}*\n💰 ${work.price} ₽`, {
        parse_mode: 'Markdown',
        ...getWorkCard(workId).keyboard
      });
      ctx.session.adminState = null;
      return;
    }

    // === ИЗМЕНЕНИЕ РАНГА ===
    if (state === 'awaiting_user_id_for_rank') {
      if (isNaN(text)) return ctx.reply('❌ ID пользователя должен быть числом. Попробуйте еще раз:');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_rank_name';
      await ctx.reply('🏅 *Введите название ранга:*\n\n• Прометей (доступ исполнителя)\n• Посейдон (полный доступ)', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      return;
    }

    if (state === 'awaiting_rank_name') {
      const userId = ctx.session.tempRankUserId;
      const rankName = text.trim();
      const validRank = loyalty.RANKS.find(r => r.name === rankName);
      
      if (!validRank) {
        return ctx.reply(`❌ Ранг "${rankName}" не найден.\n\nДоступные:\n${loyalty.RANKS.map(r => `• ${r.name}`).join('\n')}`, {
          ...getBackToAdminMenu()
        });
      }

      const loyaltyPath = path.join(__dirname, '../data/loyalty.json');
      const loyaltyData = JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));
      if (!loyaltyData[userId]) loyaltyData[userId] = { username: '', totalSpent: 0 };
      loyaltyData[userId].rank = rankName;
      fs.writeFileSync(loyaltyPath, JSON.stringify(loyaltyData, null, 2));

      await ctx.reply(`✅ Ранг пользователя \`${userId}\` изменён на "${rankName}"`, {
        parse_mode: 'Markdown',
        ...getAdminMainMenu()
      });
      ctx.session.adminState = null;
      ctx.session.tempRankUserId = null;
      return;
    }
  });

  // ==========================================
  // Обработчик inline-кнопок
  // ==========================================
  bot.action(/^admin:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }

    const action = ctx.match[1];

    // Главное меню
    if (action === 'main') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🛠 *Панель управления*', {
        parse_mode: 'Markdown',
        ...getAdminMainMenu()
      });
    }
    else if (action === 'close') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✅ *Панель управления закрыта.*', { parse_mode: 'Markdown' });
    }

    // === УПРАВЛЕНИЕ КАТАЛОГОМ ===
    else if (action === 'catalog') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗂 *Управление каталогом*\n\nВыберите курс:', {
        parse_mode: 'Markdown',
        ...getCatalogMainMenu()
      });
    }

    // Предметы курса
    else if (action.startsWith('catalog_course:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText(`📖 *Предметы курса*\n\nВыберите предмет:`, {
        parse_mode: 'Markdown',
        ...getCourseSubjects(courseId)
      });
    }

    // Работы предмета
    else if (action.startsWith('catalog_subject:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText(`📝 *Работы предмета*\n\nВыберите работу:`, {
        parse_mode: 'Markdown',
        ...getSubjectWorks(subjectId)
      });
    }

    // Карточка работы
    else if (action.startsWith('catalog_work:')) {
      const workId = action.split(':')[1];
      ctx.session.adminState = null;
      const card = getWorkCard(workId);
      await ctx.editMessageText(card.text, {
        parse_mode: 'Markdown',
        ...card.keyboard
      });
    }

    // === ДОБАВЛЕНИЕ ===
    else if (action === 'add_course') {
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ *Введите название нового курса:*\n\n(Для отмены нажмите "Назад в меню")', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action.startsWith('add_subject:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = `awaiting_subject_name:${courseId}`;
      await ctx.editMessageText('✏️ *Введите название нового предмета:*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action.startsWith('add_work:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `add_work_title:${subjectId}`;
      await ctx.editMessageText('📝 *Добавление работы. Шаг 1/6: Введите название работы:*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }

    // 🌟 === ИЗМЕНЕНИЕ КУРСА ===
    else if (action === 'edit_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение курса*\n\nВыберите курс для изменения названия:', {
        parse_mode: 'Markdown',
        ...getEditCourseList()
      });
    }
    else if (action.startsWith('edit_course_select:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      ctx.session.adminState = `edit_course_name:${courseId}`;
      await ctx.editMessageText(
        `✏️ *Изменение курса*\n\n` +
        `Текущее название: *${course.name}*\n\n` +
        `Введите новое название:`,
        {
          parse_mode: 'Markdown',
          ...getBackToAdminMenu()
        }
      );
    }

    // 🌟 === ИЗМЕНЕНИЕ ПРЕДМЕТА ===
    else if (action.startsWith('edit_subject:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение предмета*\n\nВыберите предмет для изменения названия:', {
        parse_mode: 'Markdown',
        ...getEditSubjectList(courseId)
      });
    }
    else if (action.startsWith('edit_subject_select:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      ctx.session.adminState = `edit_subject_name:${subjectId}`;
      await ctx.editMessageText(
        `✏️ *Изменение предмета*\n\n` +
        `Текущее название: *${subject.name}*\n\n` +
        `Введите новое название:`,
        {
          parse_mode: 'Markdown',
          ...getBackToAdminMenu()
        }
      );
    }

    // === УДАЛЕНИЕ ===
    else if (action === 'delete_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление курса*\n\nВыберите курс для удаления:', {
        parse_mode: 'Markdown',
        ...getDeleteCourseList()
      });
    }
    else if (action.startsWith('delete_subject:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление предмета*\n\nВыберите предмет для удаления:', {
        parse_mode: 'Markdown',
        ...getDeleteSubjectList(courseId)
      });
    }
    else if (action.startsWith('delete_work:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление работы*\n\nВыберите работу для удаления:', {
        parse_mode: 'Markdown',
        ...getDeleteWorkList(subjectId)
      });
    }

    // === УДАЛЕНИЕ — подтверждение ===
    else if (action.startsWith('delete_course_confirm:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const subjects = catalog.getSubjectsByCourse(courseId);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${course.name}"`, `admin:delete_course_execute:${courseId}`)],
        [Markup.button.callback('❌ Отмена', 'admin:catalog')]
      ]);
      
      await ctx.editMessageText(
        `⚠️ *Подтверждение удаления*\n\n` +
        `Курс: *${course.name}*\n` +
        `Предметов: ${subjects.length}\n\n` +
        `Все предметы и работы этого курса будут удалены безвозвратно!`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
    else if (action.startsWith('delete_course_execute:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const data = catalog.getData();
      
      const subjectsToDelete = data.subjects.filter(s => s.courseId === courseId).map(s => s.id);
      data.subjects = data.subjects.filter(s => s.courseId !== courseId);
      data.works = data.works.filter(w => !subjectsToDelete.includes(w.subjectId));
      data.courses = data.courses.filter(c => c.id !== courseId);
      catalog.saveData(data);
      
      await ctx.editMessageText(`✅ Курс "${course.name}" удалён!`, {
        parse_mode: 'Markdown',
        ...getCatalogMainMenu()
      });
    }

    else if (action.startsWith('delete_subject_confirm:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const works = catalog.getWorksBySubject(subjectId);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${subject.name}"`, `admin:delete_subject_execute:${subjectId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_course:${subject.courseId}`)]
      ]);
      
      await ctx.editMessageText(
        `⚠️ *Подтверждение удаления*\n\n` +
        `Предмет: *${subject.name}*\n` +
        `Работ: ${works.length}\n\n` +
        `Все работы этого предмета будут удалены безвозвратно!`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
    else if (action.startsWith('delete_subject_execute:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const data = catalog.getData();
      
      data.works = data.works.filter(w => w.subjectId !== subjectId);
      data.subjects = data.subjects.filter(s => s.id !== subjectId);
      catalog.saveData(data);
      
      await ctx.editMessageText(`✅ Предмет "${subject.name}" удалён!`, {
        parse_mode: 'Markdown',
        ...getCourseSubjects(subject.courseId)
      });
    }

    else if (action.startsWith('delete_work_confirm:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:delete_work_execute:${workId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_subject:${work.subjectId}`)]
      ]);
      
      await ctx.editMessageText(
        `⚠️ *Подтверждение удаления*\n\n` +
        `Работа: *${work.title}*\n` +
        `Цена: ${work.price} ₽\n\n` +
        `Работа будет удалена безвозвратно!`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
    else if (action.startsWith('delete_work_execute:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.id !== workId);
      catalog.saveData(data);
      
      await ctx.editMessageText(`✅ Работа "${work.title.substring(0, 40)}" удалена!`, {
        parse_mode: 'Markdown',
        ...getSubjectWorks(work.subjectId)
      });
    }

    // === РЕДАКТИРОВАНИЕ РАБОТЫ ===
    else if (action.startsWith('edit_work:')) {
      const workId = action.split(':')[1];
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Название', 'admin:edit_field:title:' + workId)],
        [Markup.button.callback('📄 Описание', 'admin:edit_field:description:' + workId)], // 🌟 НОВАЯ КНОПКА
        [Markup.button.callback('💰 Цена', 'admin:edit_field:price:' + workId)],
        [Markup.button.callback('📊 Комиссия', 'admin:edit_field:commission:' + workId)],
        [Markup.button.callback('💬 Чат (env)', 'admin:edit_field:chatEnv:' + workId)],
        [Markup.button.callback('💳 Оплата (env)', 'admin:edit_field:paymentEnv:' + workId)],
        [Markup.button.callback('📋 Требования (needs)', 'admin:edit_field:needs:' + workId)],
        [Markup.button.callback('📌 Подсказка (prompt)', 'admin:edit_field:prompt:' + workId)],
        [Markup.button.callback('⬅️ Назад', `admin:catalog_work:${workId}`)]
      ]);
      await ctx.editMessageText('✏️ *Выберите поле для изменения:*', {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }
        // === РЕДАКТИРОВАНИЕ РАБОТЫ: выбор поля и показ текущего значения ===
    else if (action.startsWith('edit_field:')) {
      const parts = action.split(':');
      const field = parts[1];
      const workId = parts[2];
      
      // Получаем текущие данные работы
      const work = catalog.getWork(workId);
      let oldValue = work ? work[field] : undefined;
      
      // 🌟 Форматируем старое значение для удобного чтения
      if (field === 'needs') {
        oldValue = Array.isArray(oldValue) && oldValue.length > 0 ? oldValue.join(', ') : 'нет';
      } else if (field === 'price') {
        oldValue = `${oldValue} ₽`;
      } else if (field === 'commission') {
        oldValue = `${oldValue}%`;
      } else if (oldValue === undefined || oldValue === null || oldValue === '') {
        oldValue = 'не указано';
      }

      // 🌟 Сохраняем состояние для обработки ввода
      ctx.session.adminState = `edit_work_input:${workId}:${field}`;
      
      // 🌟 Создаём кнопку "Назад", которая возвращает к карточке работы
      const backToWorkKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад', `admin:edit_work:${workId}`)]
      ]);
      
      await ctx.editMessageText(
        `✏️ *Введите новое значение для поля "${field}":*\n\n` +
        `📌 *Текущее значение:* \`${oldValue}\`\n\n` +
        `_(Для отмены нажмите "Назад")_`,
        {
          parse_mode: 'Markdown',
          ...backToWorkKeyboard
        }
      );
    }

    // === ИЗМЕНЕНИЕ РАНГА ===
    else if (action === 'set_user_rank') {
      ctx.session.adminState = 'awaiting_user_id_for_rank';
      await ctx.editMessageText('👤 *Введите ID пользователя:*\n\n(Например: 1012758149)', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }

    await ctx.answerCbQuery();
  });
}

module.exports = { register, showAdminMenu };