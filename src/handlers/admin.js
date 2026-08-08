const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { formatOrderCard } = require('./menu'); // Импортируем функцию форматирования карточки
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const ORDERS_PER_PAGE = 5;

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
    [Markup.button.callback('📦 Управление заказами', 'admin:orders')],
    [Markup.button.callback('🏅 Изменить ранг пользователя', 'admin:set_user_rank')],
    [Markup.button.callback('❌ Закрыть панель', 'admin:close')]
  ]);
}

function getBackToAdminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
  ]);
}

function getCatalogMainMenu() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(c.name, `admin:catalog_course:${c.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить курс', 'admin:add_course')]);
  buttons.push([Markup.button.callback('✏️ Изменить курс', 'admin:edit_course')]);
  buttons.push([Markup.button.callback('🗑 Удалить курс', 'admin:delete_course')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

function getCourseSubjects(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(s.name, `admin:catalog_subject:${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить предмет', `admin:add_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('✏️ Изменить предмет', `admin:edit_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить предмет', `admin:delete_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

function getSubjectWorks(subjectId) {
  const works = catalog.getWorksBySubject(subjectId);
  const buttons = works.map(w => [Markup.button.callback(w.title.substring(0, 45), `admin:catalog_work:${w.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить работу', `admin:add_work:${subjectId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить работу', `admin:delete_work:${subjectId}`)]);
  
  const subject = catalog.getSubject(subjectId);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_course:${subject.courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getWorkCard(workId) {
  const work = catalog.getWork(workId);
  const subject = catalog.getSubject(work.subjectId);
  const course = catalog.getCourse(subject.courseId);
  
  let text = `✏️ *Редактирование работы*\n\n`;
  text += `📚 *Курс:* ${course.name}\n`;
  text += `📖 *Предмет:* ${subject.name}\n\n`;
  text += `📝 *Название:* ${work.title}\n`;
  if (work.description && work.description.trim() !== '') text += `📄 *Описание:* ${work.description}\n`;
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

function getDeleteCourseList() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(`🗑 ${c.name}`, `admin:delete_course_confirm:${c.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

function getDeleteSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(`🗑 ${s.name}`, `admin:delete_subject_confirm:${s.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getDeleteWorkList(subjectId) {
  const works = catalog.getWorksBySubject(subjectId);
  const buttons = works.map(w => [Markup.button.callback(`🗑 ${w.title.substring(0, 40)}`, `admin:delete_work_confirm:${w.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_subject:${subjectId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getEditCourseList() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(`✏️ ${c.name}`, `admin:edit_course_select:${c.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

function getEditSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(`✏️ ${s.name}`, `admin:edit_subject_select:${s.id}`)]);
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
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    ctx.session = ctx.session || {};
    ctx.session.adminState = null;
    await ctx.reply('🛠 *Панель управления*', { parse_mode: 'Markdown', ...getAdminMainMenu() });
  });

  // ==========================================
  // Обработчик текстовых сообщений (состояния)
  // ==========================================
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    if (!ctx.session.adminState) {
      await next();
      return;
    }
    if (!isAdmin(ctx.from.id)) return;
    
    const state = ctx.session.adminState;
    const text = ctx.message.text;

    // --- КАТАЛОГ: Добавление/Изменение ---
    if (state === 'awaiting_course_name') {
      const courses = catalog.getData().courses;
      const newId = `course${Date.now()}`;
      courses.push({ id: newId, name: text });
      catalog.saveData({ ...catalog.getData(), courses });
      await ctx.reply(`✅ Курс добавлен!\n\n*Название:* ${text}\n*ID:* \`${newId}\``, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('awaiting_subject_name:')) {
      const courseId = state.split(':')[1];
      const subjects = catalog.getData().subjects;
      subjects.push({ id: `subj${Date.now()}`, courseId, name: text });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ Предмет добавлен!\n\n*Название:* ${text}`, { parse_mode: 'Markdown', ...getCourseSubjects(courseId) });
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('edit_course_name:')) {
      const courseId = state.split(':')[1];
      const data = catalog.getData();
      const idx = data.courses.findIndex(c => c.id === courseId);
      if (idx !== -1) {
        const oldName = data.courses[idx].name;
        data.courses[idx].name = text;
        catalog.saveData(data);
        await ctx.reply(`✅ Название курса изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
      }
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('edit_subject_name:')) {
      const subjectId = state.split(':')[1];
      const data = catalog.getData();
      const idx = data.subjects.findIndex(s => s.id === subjectId);
      if (idx !== -1) {
        const oldName = data.subjects[idx].name;
        const courseId = data.subjects[idx].courseId;
        data.subjects[idx].name = text;
        catalog.saveData(data);
        await ctx.reply(`✅ Название предмета изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, { parse_mode: 'Markdown', ...getCourseSubjects(courseId) });
      }
      ctx.session.adminState = null; return;
    }

    // --- КАТАЛОГ: Добавление работы ---
    if (state.startsWith('add_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text };
      ctx.session.adminState = `add_work_price:${subjectId}`;
      await ctx.reply('📝 *Шаг 2/6: Введите цену (только число):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_price:')) {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_work_commission:${state.split(':')[1]}`;
      await ctx.reply('📝 *Шаг 3/6: Введите комиссию в %:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_work_chatEnv:${state.split(':')[1]}`;
      await ctx.reply('📝 *Шаг 4/6: Имя переменной окружения для чата:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_chatEnv:')) {
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_work_paymentEnv:${state.split(':')[1]}`;
      await ctx.reply('📝 *Шаг 5/6: Имя переменной окружения для оплаты:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_paymentEnv:')) {
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_work_needs:${state.split(':')[1]}`;
      await ctx.reply('📝 *Шаг 6/6: Требования через запятую (photo, details, variant) или "нет":*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_needs:')) {
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_work_prompt:${state.split(':')[1]}`;
      await ctx.reply('📝 *Финальный шаг: Введите текст подсказки (prompt):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      await ctx.reply(`✅ *Работа добавлена!*\n\n📝 *${ctx.session.tempWorkData.title}*\n💰 ${ctx.session.tempWorkData.price} ₽`, { parse_mode: 'Markdown', ...getSubjectWorks(subjectId) });
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // --- КАТАЛОГ: Редактирование работы ---
    if (state.startsWith('edit_work_input:')) {
      const parts = state.split(':');
      const workId = parts[1]; const field = parts[2];
      const data = catalog.getData();
      const workIndex = data.works.findIndex(w => w.id === workId);
      if (workIndex === -1) return ctx.reply('❌ Работа не найдена.');
      
      let value = text;
      if ((field === 'price' || field === 'commission') && isNaN(text)) return ctx.reply('❌ Значение должно быть числом.');
      if (field === 'price' || field === 'commission') value = parseInt(text);
      
      data.works[workIndex][field] = value;
      catalog.saveData(data);
      await ctx.reply(`✅ Поле "${field}" обновлено!`, { ...getWorkCard(workId).keyboard });
      ctx.session.adminState = null; return;
    }

    // --- ЗАКАЗЫ: Редактирование заказа ---
    if (state.startsWith('edit_order_input:')) {
      const parts = state.split(':');
      const orderId = parts[1]; const field = parts[2];
      let value = text;
      if ((field === 'price' || field === 'commission') && isNaN(text)) return ctx.reply('❌ Значение должно быть числом.');
      if (field === 'price' || field === 'commission') value = parseInt(text);
      
      ordersDb.updateOrder(orderId, { [field]: value });
      const order = ordersDb.getOrder(orderId);
      
      await ctx.reply(
        `✅ Поле "${field}" обновлено!\n\nНовое значение: \`${value}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Назад к заказу', `admin:order_view:${orderId}`)]
          ])
        }
      );
      ctx.session.adminState = null; return;
    }

    // --- РАНГИ ---
    if (state === 'awaiting_user_id_for_rank') {
      if (isNaN(text)) return ctx.reply('❌ ID пользователя должен быть числом.');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_rank_name';
      await ctx.reply('🏅 *Введите название ранга:*\n\n• Прометей\n• Посейдон', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'awaiting_rank_name') {
      const userId = ctx.session.tempRankUserId;
      const rankName = text.trim();
      const validRank = loyalty.RANKS.find(r => r.name === rankName);
      if (!validRank) return ctx.reply(`❌ Ранг не найден.\n\nДоступные:\n${loyalty.RANKS.map(r => `• ${r.name}`).join('\n')}`, { ...getBackToAdminMenu() });

      const loyaltyPath = path.join(__dirname, '../data/loyalty.json');
      const loyaltyData = JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));
      if (!loyaltyData[userId]) loyaltyData[userId] = { username: '', totalSpent: 0 };
      loyaltyData[userId].rank = rankName;
      fs.writeFileSync(loyaltyPath, JSON.stringify(loyaltyData, null, 2));

      await ctx.reply(`✅ Ранг пользователя \`${userId}\` изменён на "${rankName}"`, { parse_mode: 'Markdown', ...getAdminMainMenu() });
      ctx.session.adminState = null; ctx.session.tempRankUserId = null; return;
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

    // --- ГЛАВНОЕ МЕНЮ ---
    if (action === 'main') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🛠 *Панель управления*', { parse_mode: 'Markdown', ...getAdminMainMenu() });
    }
    else if (action === 'close') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✅ *Панель управления закрыта.*', { parse_mode: 'Markdown' });
    }

    // --- КАТАЛОГ: Навигация ---
    else if (action === 'catalog') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗂 *Управление каталогом*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getCatalogMainMenu() });
    }
    else if (action.startsWith('catalog_course:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📖 *Предметы курса*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getCourseSubjects(action.split(':')[1]) });
    }
    else if (action.startsWith('catalog_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📝 *Работы предмета*\n\nВыберите работу:', { parse_mode: 'Markdown', ...getSubjectWorks(action.split(':')[1]) });
    }
    else if (action.startsWith('catalog_work:')) {
      ctx.session.adminState = null;
      const card = getWorkCard(action.split(':')[1]);
      await ctx.editMessageText(card.text, { parse_mode: 'Markdown', ...card.keyboard });
    }

    // --- КАТАЛОГ: Добавление ---
    else if (action === 'add_course') {
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ *Введите название нового курса:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_subject:')) {
      ctx.session.adminState = `awaiting_subject_name:${action.split(':')[1]}`;
      await ctx.editMessageText('✏️ *Введите название нового предмета:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_work:')) {
      ctx.session.adminState = `add_work_title:${action.split(':')[1]}`;
      await ctx.editMessageText('📝 *Шаг 1/6: Введите название работы:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }

    // --- КАТАЛОГ: Изменение ---
    else if (action === 'edit_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение курса*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getEditCourseList() });
    }
    else if (action.startsWith('edit_course_select:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = `edit_course_name:${courseId}`;
      await ctx.editMessageText(`✏️ *Текущее название:* ${catalog.getCourse(courseId).name}\n\nВведите новое:`, { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение предмета*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getEditSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('edit_subject_select:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `edit_subject_name:${subjectId}`;
      await ctx.editMessageText(`✏️ *Текущее название:* ${catalog.getSubject(subjectId).name}\n\nВведите новое:`, { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_work:')) {
      const workId = action.split(':')[1];
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Название', 'admin:edit_field:title:' + workId)],
        [Markup.button.callback('📄 Описание', 'admin:edit_field:description:' + workId)],
        [Markup.button.callback('💰 Цена', 'admin:edit_field:price:' + workId)],
        [Markup.button.callback('📊 Комиссия', 'admin:edit_field:commission:' + workId)],
        [Markup.button.callback('💬 Чат (env)', 'admin:edit_field:chatEnv:' + workId)],
        [Markup.button.callback('💳 Оплата (env)', 'admin:edit_field:paymentEnv:' + workId)],
        [Markup.button.callback('📋 Требования', 'admin:edit_field:needs:' + workId)],
        [Markup.button.callback('📌 Подсказка', 'admin:edit_field:prompt:' + workId)],
        [Markup.button.callback('⬅️ Назад', `admin:catalog_work:${workId}`)]
      ]);
      await ctx.editMessageText('✏️ *Выберите поле для изменения:*', { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('edit_field:')) {
      const parts = action.split(':');
      const field = parts[1]; const workId = parts[2];
      const work = catalog.getWork(workId);
      let oldValue = work ? work[field] : undefined;
      if (field === 'needs') oldValue = Array.isArray(oldValue) && oldValue.length > 0 ? oldValue.join(', ') : 'нет';
      else if (field === 'price') oldValue = `${oldValue} ₽`;
      else if (field === 'commission') oldValue = `${oldValue}%`;
      else if (!oldValue) oldValue = 'не указано';

      ctx.session.adminState = `edit_work_input:${workId}:${field}`;
      await ctx.editMessageText(`✏️ *Введите новое значение для поля "${field}":*\n\n📌 *Текущее:* \`${oldValue}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:edit_work:${workId}`)]]) });
    }

    // --- КАТАЛОГ: Удаление ---
    else if (action === 'delete_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление курса*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getDeleteCourseList() });
    }
    else if (action.startsWith('delete_course_confirm:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${course.name}"`, `admin:delete_course_execute:${courseId}`)],
        [Markup.button.callback('❌ Отмена', 'admin:catalog')]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nКурс: *${course.name}*\nВсе предметы и работы будут удалены!`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('delete_course_execute:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const data = catalog.getData();
      const subIds = data.subjects.filter(s => s.courseId === courseId).map(s => s.id);
      data.subjects = data.subjects.filter(s => s.courseId !== courseId);
      data.works = data.works.filter(w => !subIds.includes(w.subjectId));
      data.courses = data.courses.filter(c => c.id !== courseId);
      catalog.saveData(data);
      await ctx.editMessageText(`✅ Курс "${course.name}" удалён!`, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
    }
    else if (action.startsWith('delete_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление предмета*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getDeleteSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_subject_confirm:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const works = catalog.getWorksBySubject(subjectId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${subject.name}"`, `admin:delete_subject_execute:${subjectId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_course:${subject.courseId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nПредмет: *${subject.name}*\nРабот: ${works.length}\nВсе работы будут удалены!`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('delete_subject_execute:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.subjectId !== subjectId);
      data.subjects = data.subjects.filter(s => s.id !== subjectId);
      catalog.saveData(data);
      await ctx.editMessageText(`✅ Предмет "${subject.name}" удалён!`, { parse_mode: 'Markdown', ...getCourseSubjects(subject.courseId) });
    }
    else if (action.startsWith('delete_work:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление работы*\n\nВыберите работу:', { parse_mode: 'Markdown', ...getDeleteWorkList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_work_confirm:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:delete_work_execute:${workId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_subject:${work.subjectId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nРабота: *${work.title}*\nЦена: ${work.price} ₽`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('delete_work_execute:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.id !== workId);
      catalog.saveData(data);
      await ctx.editMessageText(`✅ Работа удалена!`, { parse_mode: 'Markdown', ...getSubjectWorks(work.subjectId) });
    }

    // ==========================================
    // 📦 УПРАВЛЕНИЕ ЗАКАЗАМИ
    // ==========================================
    else if (action === 'orders') {
      ctx.session.adminState = null;
      const all = ordersDb.getAllOrders();
      const p = all.filter(o => o.status === 'pending').length;
      const a = all.filter(o => o.status === 'active').length;
      const c = all.filter(o => o.status === 'completed').length;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`⏳ Ожидают (${p})`, 'admin:orders_list:pending:0')],
        [Markup.button.callback(`🔨 В работе (${a})`, 'admin:orders_list:active:0')],
        [Markup.button.callback(`✅ Выполнены (${c})`, 'admin:orders_list:completed:0')],
        [Markup.button.callback('📦 Все заказы', 'admin:orders_list:all:0')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(`📦 *Управление заказами*\n\nВсего: *${all.length}*\n⏳ Ожидают: *${p}*\n🔨 В работе: *${a}*\n✅ Выполнены: *${c}*`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('orders_list:')) {
      const parts = action.split(':');
      const filter = parts[1];
      const page = parseInt(parts[2]) || 0;
      
      const all = ordersDb.getAllOrders();
      let filtered = all;
      let title = '📦 Все заказы';
      if (filter === 'pending') { filtered = all.filter(o => o.status === 'pending'); title = '⏳ Ожидают принятия'; }
      else if (filter === 'active') { filtered = all.filter(o => o.status === 'active'); title = '🔨 В работе'; }
      else if (filter === 'completed') { filtered = all.filter(o => o.status === 'completed'); title = '✅ Выполнены'; }
      
      const totalPages = Math.max(1, Math.ceil(filtered.length / ORDERS_PER_PAGE));
      const currentPage = Math.min(page, totalPages - 1);
      const displayOrders = filtered.slice(currentPage * ORDERS_PER_PAGE, (currentPage + 1) * ORDERS_PER_PAGE).reverse();
      
      let text = `${title}\n\nСтраница ${currentPage + 1} из ${totalPages}\nВсего: ${filtered.length}`;
      const buttons = displayOrders.map(o => {
        const customer = o.customerUsername ? `@${o.customerUsername}` : `ID:${o.customerId}`;
        const date = o.createdAt.split(' ')[0];
        return [Markup.button.callback(`📝 ${o.workTitle.substring(0, 20)} | ${date}`, `admin:order_view:${o.id}`)];
      });
      if (buttons.length === 0) buttons.push([Markup.button.callback('— пусто —', 'noop')]);
      
      const navRow = [];
      if (currentPage > 0) navRow.push(Markup.button.callback('◀️', `admin:orders_list:${filter}:${currentPage - 1}`));
      navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
      if (currentPage < totalPages - 1) navRow.push(Markup.button.callback('▶️', `admin:orders_list:${filter}:${currentPage + 1}`));
      buttons.push(navRow);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:orders')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_view:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }
      
      const text = formatOrderCard(order, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)],
        [Markup.button.callback('💬 Написать заказчику', `admin:order_message_customer:${orderId}`)]
      ];
      if (order.customerUsername) buttons.push([Markup.button.url('🔗 Профиль заказчика', `https://t.me/${order.customerUsername}`)]);
      
      if (order.status === 'pending') {
        buttons.push([Markup.button.callback('🔨 Перевести в работу', `admin:order_status:${orderId}:active`)]);
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
      } else if (order.status === 'active') {
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
        buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
      } else {
        buttons.push([Markup.button.callback('🔨 Вернуть в работу', `admin:order_status:${orderId}:active`)]);
        buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
      }
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_edit:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) return;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Название работы', `admin:order_field:${orderId}:workTitle`)],
        [Markup.button.callback('📖 Предмет', `admin:order_field:${orderId}:subjectName`)],
        [Markup.button.callback('🎓 Курс', `admin:order_field:${orderId}:courseName`)],
        [Markup.button.callback('💰 Цена', `admin:order_field:${orderId}:price`)],
        [Markup.button.callback('📊 Комиссия', `admin:order_field:${orderId}:commission`)],
        [Markup.button.callback('👤 Username заказчика', `admin:order_field:${orderId}:customerUsername`)],
        [Markup.button.callback('👷 Username исполнителя', `admin:order_field:${orderId}:executorUsername`)],
        [Markup.button.callback('⬅️ Назад к заказу', `admin:order_view:${orderId}`)]
      ]);
      await ctx.editMessageText(`✏️ *Редактирование заказа №${order.orderNumber}*\n\nВыберите поле для изменения:`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('order_field:')) {
      const parts = action.split(':');
      const orderId = parts[1]; const field = parts[2];
      const order = ordersDb.getOrder(orderId);
      if (!order) return;
      
      let oldValue = order[field];
      if (oldValue === undefined || oldValue === null || oldValue === '') oldValue = 'не указано';
      else if (field === 'price') oldValue = `${oldValue} ₽`;
      else if (field === 'commission') oldValue = `${oldValue}%`;
      
      ctx.session.adminState = `edit_order_input:${orderId}:${field}`;
      await ctx.editMessageText(`✏️ *Введите новое значение для поля "${field}":*\n\n📌 *Текущее:* \`${oldValue}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:order_edit:${orderId}`)]]) });
    }
    else if (action.startsWith('order_status:')) {
      const parts = action.split(':');
      const orderId = parts[1]; const newStatus = parts[2];
      const order = ordersDb.getOrder(orderId);
      const updates = { status: newStatus };
      if (newStatus === 'active' && !order.acceptedAt) updates.acceptedAt = new Date().toLocaleString('ru-RU');
      if (newStatus === 'completed' && !order.completedAt) updates.completedAt = new Date().toLocaleString('ru-RU');
      
      ordersDb.updateOrder(orderId, updates);
      await ctx.answerCbQuery('✅ Статус изменён');
      
      // Перерисовываем экран просмотра заказа
      const updatedOrder = ordersDb.getOrder(orderId);
      const text = formatOrderCard(updatedOrder, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)]
      ];
      if (updatedOrder.customerUsername) buttons.push([Markup.button.url('💬 Профиль заказчика', `https://t.me/${updatedOrder.customerUsername}`)]);
      
      if (updatedOrder.status === 'pending') {
        buttons.push([Markup.button.callback('🔨 Перевести в работу', `admin:order_status:${orderId}:active`)]);
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
      } else if (updatedOrder.status === 'active') {
        buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
        buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
      } else {
        buttons.push([Markup.button.callback('🔨 Вернуть в работу', `admin:order_status:${orderId}:active`)]);
        buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
      }
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_delete:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:order_delete_confirm:${orderId}`)],
        [Markup.button.callback('❌ Отмена', `admin:order_view:${orderId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение удаления*\n\nЗаказ: *${order.workTitle}*\nЗаказчик: ${order.customerUsername ? `@${order.customerUsername}` : order.customerId}`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('order_delete_confirm:')) {
      const orderId = action.split(':')[1];
      ordersDb.deleteOrder(orderId);
      await ctx.answerCbQuery('✅ Заказ удалён');
      
      const all = ordersDb.getAllOrders();
      const p = all.filter(o => o.status === 'pending').length;
      const a = all.filter(o => o.status === 'active').length;
      const c = all.filter(o => o.status === 'completed').length;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`⏳ Ожидают (${p})`, 'admin:orders_list:pending:0')],
        [Markup.button.callback(`🔨 В работе (${a})`, 'admin:orders_list:active:0')],
        [Markup.button.callback(`✅ Выполнены (${c})`, 'admin:orders_list:completed:0')],
        [Markup.button.callback('📦 Все заказы', 'admin:orders_list:all:0')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(`✅ *Заказ удалён!*\n\n📦 *Управление заказами*\n\nВсего заказов: *${all.length}*`, { parse_mode: 'Markdown', ...keyboard });
    }

    // --- РАНГИ ---
    else if (action === 'set_user_rank') {
      ctx.session.adminState = 'awaiting_user_id_for_rank';
      await ctx.editMessageText('👤 *Введите ID пользователя:*\n\n(Например: 1012758149)', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }

    await ctx.answerCbQuery();
  });

// Обработчик отправки сообщения заказчику
bot.on('text', async (ctx, next) => {
  ctx.session = ctx.session || {};
  const state = ctx.session.adminState;
  if (!state || !state.startsWith('send_message_to_customer:')) {
    await next();
    return;
  }
  if (!isAdmin(ctx.from.id)) return;
  
  const orderId = state.split(':')[1];
  const order = ordersDb.getOrder(orderId);
  if (!order) {
    await ctx.reply('❌ Заказ не найден');
    ctx.session.adminState = null;
    return;
  }
  
  const messageText = ctx.message.text;
  const customerId = order.customerId;
  
  try {
    await ctx.telegram.sendMessage(customerId, `📬 *Сообщение от администрации по заказу №${order.orderNumber}*\\n\\n${messageText}`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Сообщение отправлено заказчику ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + customerId}`);
  } catch (err) {
    await ctx.reply(`❌ Не удалось отправить сообщение: ${err.message}`);
  }
  
  ctx.session.adminState = null;
});

}

module.exports = { register, showAdminMenu };