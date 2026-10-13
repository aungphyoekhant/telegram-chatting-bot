import "dotenv/config";
import { Bot, type Context } from "grammy";
import express from "express";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "google/gemma-4-26b-a4b-it:free";
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing from .env");
}

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is missing from .env");
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// --- Express Keep-Alive Server (Render Free tier အတွက် လိုအပ်သည်) ---
const app = express();

app.get("/", (req, res) => {
  res.send("🤖 Telegram AI Bot is alive and running!");
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🌐 Express server is listening on port ${PORT}`);
});
// -----------------------------------------------------------------

// Keep recent conversation history separately for each Telegram chat.
const conversations = new Map<
  number,
  Array<{ role: "user" | "assistant"; content: string }>
>();

const MAX_HISTORY_MESSAGES = 12;

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    code?: number | string;
    metadata?: unknown;
  };
}

async function askAI(chatId: number, userMessage: string): Promise<string> {
  const history = conversations.get(chatId) ?? [];

  const messages = [
    {
      role: "system",
      content: `
You are a friendly and helpful AI chatting assistant on Telegram.

- Reply in the language used by the user.
- If the user writes Burmese, reply naturally in Burmese.
- If the user writes English, reply in English.
- Be friendly, clear, and helpful.
- Explain technical topics step by step when needed.
- Do not invent facts when you are unsure.
- You are a general chatting assistant, not a driving license or NRC verification service.
      `.trim(),
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  const result = (await response
    .json()
    .catch(() => ({}))) as OpenRouterResponse;

  if (!response.ok) {
    console.error("OpenRouter HTTP error:", response.status);
    console.error(
      "Provider details:",
      JSON.stringify(result.error ?? {}, null, 2),
    );

    if (response.status === 401) {
      throw new Error("OpenRouter API key မှားနေပါတယ်။");
    }

    if (response.status === 402) {
      throw new Error(
        "OpenRouter credit မလုံလောက်ပါ။ Account ရဲ့ credit ကို စစ်ဆေးပါ။",
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Model ကို ရှာမတွေ့ပါ သို့မဟုတ် အသုံးပြုခွင့်မရှိပါ။ .env ထဲက model ID ကို စစ်ပါ။",
      );
    }

    if (response.status === 429) {
      throw new Error(
        "AI service အလုပ်များနေပါတယ် သို့မဟုတ် rate limit ရှိနေပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။",
      );
    }

    throw new Error(`AI service error: HTTP ${response.status}`);
  }

  const content = result.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    console.error("Empty AI response:", {
      model: OPENROUTER_MODEL,
      finishReason: result.choices?.[0]?.finish_reason,
    });

    throw new Error("AI က အဖြေမပြန်ပေးနိုင်သေးပါ။ ပြန်စမ်းကြည့်ပါ။");
  }

  // Store the conversation only after a successful response.
  history.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: content.trim() },
  );

  // Keep only the most recent messages to limit context size.
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
  conversations.set(chatId, recentHistory);

  return content.trim();
}

bot.command("start", async (ctx: Context) => {
  await ctx.reply(
    [
      "မင်္ဂလာပါ 👋",
      "",
      "ကျွန်တော့်ရဲ့ AI Chatting Bot မှ ကြိုဆိုပါတယ်။ 🤖",
      "",
      "မြန်မာလိုဖြစ်ဖြစ် English လိုဖြစ်ဖြစ် လွတ်လပ်စွာ မေးနိုင်ပါတယ်။",
      "",
      "Commands:",
      "/start - Bot စတင်ရန်",
      "/help - အသုံးပြုနည်း",
      "/reset - Chat history ရှင်းရန်",
    ].join("\n"),
  );
});

bot.command("help", async (ctx: Context) => {
  await ctx.reply(
    [
      "📖 အသုံးပြုနည်း",
      "",
      "• စကားပြောချင်တာကို ပုံမှန် message အဖြစ် ပို့ပါ။",
      "• AI က မြန်မာလိုနဲ့ English လို ပြန်ဖြေနိုင်ပါတယ်။",
      "• အရင်ပြောထားတဲ့ စကားတွေကို အနည်းငယ် မှတ်ထားပေးပါတယ်။",
      "• /reset နဲ့ လက်ရှိ chat history ကို ရှင်းနိုင်ပါတယ်။",
    ].join("\n"),
  );
});

bot.command("reset", async (ctx: Context) => {
  conversations.delete(ctx.chat.id);

  await ctx.reply(
    "🧹 Chat history ကို ရှင်းပြီးပါပြီ။ စကားဝိုင်းအသစ် စလို့ရပါပြီ။",
  );
});

// Handle ordinary text messages.
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text.trim();

  if (!userMessage || userMessage.startsWith("/")) {
    return;
  }

  await ctx.reply("💭 စဉ်းစားနေပါတယ်...");

  try {
    const answer = await askAI(ctx.chat.id, userMessage);

    // Telegram messages have a maximum text length.
    const chunkSize = 4000;

    for (let i = 0; i < answer.length; i += chunkSize) {
      await ctx.reply(answer.slice(i, i + chunkSize));
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "မသိရှိသော error တစ်ခု ဖြစ်နေပါတယ်။";

    console.error("Chat error:", message);

    await ctx.reply(`❌ ${message}`);
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error.message);
});

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Chatting Bot is running: @${botInfo.username}`);
    console.log(`🤖 Model: ${OPENROUTER_MODEL}`);
  },
});
