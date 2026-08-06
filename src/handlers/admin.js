const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const { createInlineKeyboard } = require('../utils/keyboard');
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

//  Вспомогательная функция проверки прав (только Посейдон)
function isAdmin(userId) {
  const info = loyalty.getLoyaltyInfo(userId);
  return info.hasFullAccess;
}

// ==========================================
// Вспомогательные функции клавиатур (на верхнем уровне)
// ==========================================
function getAdminMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(' Курсы', 'admin:courses'), Markup.button.callback('➕ Добавить курс', 'admin:add_course')],
    [Markup.button.callback('📖 Предметы', 'admin:subjects'), Markup.button.callback('➕ Добавить предмет', 'admin:add_subject')],
    [Markup.button.callback('📝 Работы', 'admin:works'), Markup.button.callback('➕ Добавить работу', 'admin:add_work')],
    [Markup.button.callback('✏️ Изменить работу', 'admin:edit_work')],
    [Markup.button.callback('🏅 Изменить ранг пользователя', 'admin:set_user_rank')],
    [Markup.button.callback('❌ Закрыть панель', 'admin:close')]
  ]);
}

function getBackToAdminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
  ]);
}

function getCourseSelectionKeyboard(prefix) {
  const buttons = catalog.courses.map(c => [Markup.button.callback(c.name, `${prefix}${c.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

function getSubjectSelectionKeyboard(courseId, prefix) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(s.name, `${prefix}${s.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

function getWorkSelectionKeyboard() {
  const recentWorks = catalog.works.slice(-10).reverse();
  const buttons = recentWorks.map(w => [Markup.button.callback(w.title.substring(0, 40), `edit_work_select:${w.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

function getEditWorkFieldsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Название', 'edit_work_field:title')],
    [Markup.button.callback('Цена', 'edit_work_field:price')],
    [Markup.button.callback('Комиссия', 'edit_work_field:commission')],
    [Markup.button.callback('Чат (env)', 'edit_work_field:chatEnv')],
    [Markup.button.callback('Оплата (env)', 'edit_work_field:paymentEnv')],
    [Markup.button.callback('Требования (needs)', 'edit_work_field:needs')],
    [Markup.button.callback('Подсказка (prompt)', 'edit_work_field:prompt')],
    [Markup.button.callback('⬅️ Назад', 'admin:edit_work')]
  ]);
}

// 🌟 Функция для показа админ-меню из других модулей (например, из профиля)
async function showAdminMenu(ctx) {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    return;
  }
  ctx.session = ctx.session || {};
  ctx.session.adminState = 'main_menu';
  await ctx.reply('🛠 *Панель управления каталогом*', {
    parse_mode: 'Markdown',
    ...getAdminMainMenu() // 🌟 Теперь эта функция доступна!
  });
}

function register(bot) {
  // 🌟 Команда /admin для входа в админ-панель
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    }
    ctx.session.adminState = 'main_menu';
    await ctx.reply(' *Панель управления каталогом*', {
      parse_mode: 'Markdown',
      ...getAdminMainMenu()
    });
  });

  // ==========================================
  // Обработчик текстовых сообщений (состояния)
  // ==========================================
  bot.on('text', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const state = ctx.session.adminState;
    if (!state) return;

    if (state.startsWith('add_work_') || state === 'awaiting_course_name' || state === 'awaiting_subject_name') {
      await handleAddWorkStep(ctx, state);
      return;
    }

    if (state.startsWith('edit_work_field_')) {
      await handleEditWorkStep(ctx, state);
      return;
    }

    if (state === 'awaiting_user_id_for_rank' || state === 'awaiting_rank_name') {
      await handleAddWorkStep(ctx, state);
      return;
    }
  });

  // ==========================================
  // Навигация админ-панели (inline-кнопки)
  // ==========================================
  bot.action(/^admin:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав для этого действия');
      return;
    }

    const action = ctx.match[1];

    if (action === 'main') {
      ctx.session.adminState = 'main_menu';
      await ctx.editMessageText('🛠 *Панель управления каталогом*', {
        parse_mode: 'Markdown',
        ...getAdminMainMenu()
      });
    }
    else if (action === 'add_course') {
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ *Введите название нового курса:*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action === 'add_subject') {
      ctx.session.adminState = 'awaiting_subject_course';
      await ctx.editMessageText('📚 *Выберите курс для нового предмета:*', {
        parse_mode: 'Markdown',
        ...getCourseSelectionKeyboard('admin:add_subject_confirm:')
      });
    }
    else if (action === 'add_work') {
      ctx.session.adminState = 'add_work_course';
      await ctx.editMessageText('📝 *Добавление новой работы. Шаг 1/8: Выберите курс:*', {
        parse_mode: 'Markdown',
        ...getCourseSelectionKeyboard('admin:add_work_subject:')
      });
    }
    else if (action === 'edit_work') {
      ctx.session.adminState = 'edit_work_select';
      await ctx.editMessageText('✏️ *Изменение работы. Выберите работу из списка:*', {
        parse_mode: 'Markdown',
        ...getWorkSelectionKeyboard()
      });
    }
    else if (action === 'set_user_rank') {
      ctx.session.adminState = 'awaiting_user_id_for_rank';
      await ctx.editMessageText('👤 *Введите ID пользователя, которому нужно изменить ранг:*\n\n(Например: 1012758149)', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action.startsWith('add_subject_confirm:')) {
      const courseId = action.split(':')[2];
      ctx.session.tempSubjectCourseId = courseId;
      ctx.session.adminState = 'awaiting_subject_name';
      await ctx.editMessageText(`✏️ *Введите название предмета для курса ID: \`${courseId}\`*`, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action.startsWith('admin:add_work_subject:')) {
      const courseId = action.split(':')[3];
      ctx.session.tempWorkCourseId = courseId;
      ctx.session.adminState = 'add_work_subject_select';
      await ctx.editMessageText('📝 *Шаг 2/8: Выберите предмет:*', {
        parse_mode: 'Markdown',
        ...getSubjectSelectionKeyboard(courseId, 'admin:add_work_start:')
      });
    }
    else if (action.startsWith('admin:add_work_start:')) {
      const subjectId = action.split(':')[3];
      ctx.session.tempWorkSubjectId = subjectId;
      ctx.session.tempWorkData = { courseId: ctx.session.tempWorkCourseId, subjectId };
      ctx.session.adminState = 'add_work_title';
      await ctx.editMessageText('📝 *Шаг 3/8: Введите название работы:*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action.startsWith('edit_work_select:')) {
      const workId = action.split(':')[2];
      ctx.session.editingWorkId = workId;
      ctx.session.adminState = 'edit_work_field_select';
      const work = catalog.getWork(workId);
      await ctx.editMessageText(`✏️ *Редактирование: ${work.title}*\n\nВыберите поле для изменения:`, {
        parse_mode: 'Markdown',
        ...getEditWorkFieldsKeyboard()
      });
    }
    else if (action.startsWith('edit_work_field:')) {
      const field = action.split(':')[2];
      ctx.session.adminState = `edit_work_field_${field}`;
      await ctx.editMessageText(`✏️ *Введите новое значение для поля "${field}":*`, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (action === 'close') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✅ *Панель управления закрыта.*', {
        parse_mode: 'Markdown'
      });
    }

    await ctx.answerCbQuery();
  });

  // ==========================================
  // Обработчики шагов добавления работы и изменения ранга
  // ==========================================
  async function handleAddWorkStep(ctx, state) {
    const text = ctx.message.text;
    const data = ctx.session.tempWorkData || {};

    if (state === 'awaiting_course_name') {
      const courses = catalog.getData().courses;
      const newId = `course${courses.length + 1}`;
      courses.push({ id: newId, name: text });
      catalog.saveData({ ...catalog.getData(), courses });
      await ctx.reply(`✅ Курс добавлен! ID: \`${newId}\``, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      ctx.session.adminState = 'main_menu';
    }
    else if (state === 'awaiting_subject_name') {
      const subjects = catalog.getData().subjects;
      const newId = `subj${Date.now()}`;
      subjects.push({ id: newId, courseId: ctx.session.tempSubjectCourseId, name: text });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ Предмет добавлен! ID: \`${newId}\``, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      ctx.session.adminState = 'main_menu';
    }
    else if (state === 'add_work_title') {
      data.title = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_price';
      await ctx.reply(' *Шаг 4/8: Введите цену (только число, например 1500):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_price') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом. Попробуйте еще раз:');
      data.price = parseInt(text);
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_commission';
      await ctx.reply('📝 *Шаг 5/8: Введите комиссию в % (например, 20):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_commission') {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом. Попробуйте еще раз:');
      data.commission = parseInt(text);
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_chatEnv';
      await ctx.reply('📝 *Шаг 6/8: Введите имя переменной окружения для чата (например, MY_CHAT_ID):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_chatEnv') {
      data.chatEnv = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_paymentEnv';
      await ctx.reply('📝 *Шаг 7/8: Введите имя переменной окружения для оплаты (например, MY_CARD_NUMBER):*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_paymentEnv') {
      data.paymentEnv = text;
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_needs';
      await ctx.reply('📝 *Шаг 8/8: Что требуется от пользователя? Введите через запятую: photo, details, variant. Или введите "нет":*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_needs') {
      data.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData = data;
      ctx.session.adminState = 'add_work_prompt';
      await ctx.reply('📝 *Финальный шаг: Введите текст подсказки (prompt), который бот покажет пользователю:*', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'add_work_prompt') {
      data.prompt = text;
      data.id = `work_${Date.now()}`;

      const works = catalog.getData().works;
      works.push(data);
      catalog.saveData({ ...catalog.getData(), works });

      await ctx.reply(`✅ *Работа успешно добавлена!*\n\nID: \`${data.id}\`\nНазвание: ${data.title}\nЦена: ${data.price} ₽`, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      ctx.session.adminState = 'main_menu';
      ctx.session.tempWorkData = null;
    }
    else if (state === 'awaiting_user_id_for_rank') {
      if (isNaN(text)) return ctx.reply('❌ ID пользователя должен быть числом. Попробуйте еще раз:');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_rank_name';
      await ctx.reply('🏅 *Введите название ранга:*\n\nДоступные варианты:\n• Прометей (доступ исполнителя)\n• Посейдон (полный доступ)', {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
    }
    else if (state === 'awaiting_rank_name') {
      const userId = ctx.session.tempRankUserId;
      const rankName = text.trim();

      const validRank = loyalty.RANKS.find(r => r.name === rankName);
      if (!validRank) {
        return ctx.reply(`❌ Ранг "${rankName}" не найден. Доступные ранги:\n\n${loyalty.RANKS.map(r => `• ${r.name}`).join('\n')}`, {
          ...getBackToAdminMenu()
        });
      }

      const loyaltyPath = path.join(__dirname, '../data/loyalty.json');
      const loyaltyData = JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));

      if (!loyaltyData[userId]) {
        loyaltyData[userId] = { username: '', totalSpent: 0 };
      }

      loyaltyData[userId].rank = rankName;
      fs.writeFileSync(loyaltyPath, JSON.stringify(loyaltyData, null, 2));

      await ctx.reply(`✅ Ранг пользователя \`${userId}\` изменён на "${rankName}"`, {
        parse_mode: 'Markdown',
        ...getBackToAdminMenu()
      });
      ctx.session.adminState = 'main_menu';
      ctx.session.tempRankUserId = null;
    }
  }

  // ==========================================
  // Обработчики шагов изменения работы
  // ==========================================
  async function handleEditWorkStep(ctx, state) {
    const text = ctx.message.text;
    const workId = ctx.session.editingWorkId;
    const data = catalog.getData();
    const workIndex = data.works.findIndex(w => w.id === workId);

    if (workIndex === -1) return ctx.reply('❌ Работа не найдена.');

    const field = state.replace('edit_work_field_', '');
    let value = text;

    if ((field === 'price' || field === 'commission') && isNaN(text)) {
      return ctx.reply('❌ Значение должно быть числом. Попробуйте еще раз:');
    }
    if (field === 'price' || field === 'commission') value = parseInt(text);
    if (field === 'needs') value = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());

    data.works[workIndex][field] = value;
    catalog.saveData(data);

    await ctx.reply(`✅ Поле "${field}" успешно обновлено!`, {
      ...getBackToAdminMenu()
    });
    ctx.session.adminState = 'main_menu';
    ctx.session.editingWorkId = null;
  }
}

module.exports = { register, showAdminMenu };