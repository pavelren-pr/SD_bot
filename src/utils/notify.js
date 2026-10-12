async function sendTempNotification(ctx, text, delayMs = 3000) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text);
    } else {
      const msg = await ctx.reply(text);
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
        } catch (e) { /* ignore */ }
      }, delayMs);
    }
  } catch (e) {
    console.log('Не удалось показать уведомление:', e.message);
  }
}

module.exports = { sendTempNotification };