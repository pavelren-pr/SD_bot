function register(bot) {
  
  bot.command('help', async (ctx) => {
    await ctx.reply('📞 Если у вас есть вопросы, напишите нашему менеджеру: @SmartDealsManager', {
      parse_mode: 'Markdown'
    });
  });
}

module.exports = { register };