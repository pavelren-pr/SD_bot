const { Markup } = require('telegraf');

const loyaltyDocLink = 'https://docs.google.com/document/d/1tcjS6BL9TVWVeH-cG7jj0lyYwJtyPViWj60lzhd3x-A/edit?usp=sharing';
const trackingManagerLink = 'https://t.me/SmartDealsManager';

const Drive1yearLink = 'https://drive.google.com/drive/folders/1nAbmEz2CvQAzk2yZG8jdBrZ7VpDy8Dle?usp=sharing';
const Drive2yearLink = 'https://drive.google.com/drive/folders/1GtQEJQESq0OVhOGmWE3zo94PfScD3ypk?usp=sharing';
const Drive3yearLink = 'https://drive.google.com/drive/folders/1pU-uhO03bL6IJq9Js6f-DtaomNwPd90t?usp=sharing';
const Drive4yearLink = 'https://drive.google.com/drive/folders/1ImX8bRsg1OFrsIY0LmuYjecOfuu2U4N_?usp=sharing';
const DrivePractice = 'https://drive.google.com/drive/folders/1lNX7F6AUTA7SSIhwhLlQebDFvGnAJT-E?usp=sharing';

function register(bot) {
  // Главное меню сокровищницы
  bot.action('treasure:main', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('1 курс ⭐️', 'treasure:1')],
      [Markup.button.callback('2 курс ⭐️⭐️', 'treasure:2')],
      [Markup.button.callback('3 курс ⭐️⭐️⭐️', 'treasure:3')],
      [Markup.button.callback('4 курс ⭐️⭐️⭐️⭐️', 'treasure:4')],
      [Markup.button.callback('Практика 🚢', 'treasure:prac')],
      [Markup.button.callback('🥂 Предложить работу 🥂', 'treasure:offer')]
    ]);

    const text = `💰 <b>Морская Сокровищница</b> 💰\n\nВыберите раздел, чтобы получить доступ к материалам:`;
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      await ctx.answerCbQuery();
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  //  Вспомогательная функция для создания сообщения с кнопками
  function createTreasureMessage(title, link) {
    return {
      text: `💰 <b>Морская Сокровищница</b> 💰\n${title}\n\nВсе материалы расположены на Google Drive, для доступа необходимо перейти по ссылке 🔗`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.url('Ссылка на Google Drive 📁', link)],
        [Markup.button.callback('Назад 🔙', 'treasure:main')]
      ])
    };
  }

  // 🌟 Обработчики подразделов с ИСПРАВЛЕННОЙ передачей клавиатуры
  bot.action('treasure:1', async (ctx) => {
    const data = createTreasureMessage('1 курс ⭐️', Drive1yearLink);
    await ctx.editMessageText(data.text, { parse_mode: 'HTML', ...data.keyboard }); // 🌟 Распаковка
    await ctx.answerCbQuery();
  });

  bot.action('treasure:2', async (ctx) => {
    const data = createTreasureMessage('2 курс ⭐️⭐️', Drive2yearLink);
    await ctx.editMessageText(data.text, { parse_mode: 'HTML', ...data.keyboard }); // 🌟 Распаковка
    await ctx.answerCbQuery();
  });

  bot.action('treasure:3', async (ctx) => {
    const data = createTreasureMessage('3 курс ️⭐️⭐️', Drive3yearLink);
    await ctx.editMessageText(data.text, { parse_mode: 'HTML', ...data.keyboard }); //  Распаковка
    await ctx.answerCbQuery();
  });

  bot.action('treasure:4', async (ctx) => {
    const data = createTreasureMessage('4 курс ⭐️⭐️⭐️⭐️', Drive4yearLink);
    await ctx.editMessageText(data.text, { parse_mode: 'HTML', ...data.keyboard }); // 🌟 Распаковка
    await ctx.answerCbQuery();
  });

  bot.action('treasure:prac', async (ctx) => {
    const data = createTreasureMessage('Практика 🚢', DrivePractice);
    await ctx.editMessageText(data.text, { parse_mode: 'HTML', ...data.keyboard }); // 🌟 Распаковка
    await ctx.answerCbQuery();
  });

  bot.action('treasure:offer', async (ctx) => {
    const user = ctx.from;
    const text = `Мы ценим твою инициативу, ✨${user.first_name}✨\n\n` +
                 `Для предложения работы или услуги напиши нашему <a href="${trackingManagerLink}">менеджеру</a>.\n\n` +
                 `Будем очень рады и достойно <a href="${loyaltyDocLink}">вознаградим Вас (см. п. 4)</a> за пополнение общей сокровищницы, а так же выполнение работ через наш сервис.`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Назад 🔙', 'treasure:main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true }); // 🌟 Распаковка
    await ctx.answerCbQuery();
  });
}

module.exports = { register };