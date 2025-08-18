// index.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// --- Health checks ---
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

// --- 環境變數 ---
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- 記憶設定（每聊天室 3 輪、15 分鐘）---
const MEMORY_TURNS = 3;
const MEMORY_TTL_MS = 15 * 60 * 1000;
const chatMemory = Object.create(null);

function getChatId(event) {
  return event?.source?.groupId || event?.source?.roomId || event?.source?.userId || "unknown";
}
function now() { return Date.now(); }
function pruneExpired(chatId) {
  const list = chatMemory[chatId] || [];
  chatMemory[chatId] = list.filter(m => now() - m.ts < MEMORY_TTL_MS);
}
function pushMemory(chatId, role, content) {
  if (!chatMemory[chatId]) chatMemory[chatId] = [];
  chatMemory[chatId].push({ role, content, ts: now() });
  const keep = MEMORY_TURNS * 2;
  if (chatMemory[chatId].length > keep) {
    chatMemory[chatId] = chatMemory[chatId].slice(-keep);
  }
}

// --- 觸發條件：訊息中含有「@gpt」 ---
function shouldTrigger(text) {
  if (!text) return false;
  return /@gpt/i.test(text);
}

// --- 去掉所有「@gpt」標註，回傳乾淨內容 ---
function stripAtGpt(text) {
  if (!text) return "";
  return text.replace(/@gpt/gi, "").trim();
}

// --- LINE Webhook ---
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // 先回 200，避免超時

  const events = req.body?.events || [];
  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const rawText = event.message.text || "";
    const chatId = getChatId(event);
    console.log(`[${chatId}] 收到訊息：`, rawText);

    // 僅當含有 @gpt 才觸發
    if (!shouldTrigger(rawText)) {
      console.log(`[${chatId}] 未觸發（未含 @gpt），忽略。`);
      continue;
    }

    const userClean = stripAtGpt(rawText);
    if (!userClean) {
      await replyText(event.replyToken, "GPT 在這裡～請在訊息裡 @我 並加上你的問題喔。");
      continue;
    }

    try {
      pruneExpired(chatId);
      const history = (chatMemory[chatId] || []).map(m => ({ role: m.role, content: m.content }));

      const messages = [
        {
          role: "system",
          content:
            "你自稱『GPT』。說話風格可愛但簡潔俐落、有條理，必須一律使用繁體中文。" +
            "回覆請活潑又不囉嗦，能快速總結，再用條列或短句整理重點。"
        },
        ...history,
        { role: "user", content: userClean }
      ];

      const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages
        })
      });

      if (!gptResponse.ok) {
        const errText = await gptResponse.text();
        console.error(`[${chatId}] GPT API 錯誤：`, gptResponse.status, errText);
        await replyText(event.replyToken, "GPT 剛剛打了個盹，請再 @我一次～");
        continue;
      }

      const data = await gptResponse.json();
      const reply =
        data?.choices?.[0]?.message?.content?.trim() ||
        "我在這裡呀！只要在訊息中加上 @gpt，再告訴我需求就好～";

      await replyText(event.replyToken, reply);
      console.log(`[${chatId}] 已回覆：`, reply);

      // 紀錄對話
      pushMemory(chatId, "user", userClean);
      pushMemory(chatId, "assistant", reply);

    } catch (err) {
      console.error(`[${chatId}] 處理訊息錯誤：`, err);
      await replyText(event.replyToken, "哎呀，GPT 被噴嚏打斷了，再 @我一次吧～");
    }
  }
});

// --- LINE 回覆函數 ---
async function replyText(replyToken, text) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

// --- 監聽 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
