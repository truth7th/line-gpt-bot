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

// --- 會話模式（召喚後，任何人可對話；逾時/回合自動安靜）---
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 分鐘
const SESSION_TURNS = 10;               // 最多 10 則 GPT 回覆
const chatSession = Object.create(null); // { [chatId]: { expireAt, turnsLeft } }

// 召喚 / 離場判定
function containsAtGpt(text) {
  return /@gpt/i.test(text || "");
}
function isEndCommand(text) {
  const t = (text || "").trim().toLowerCase();
  return /^(結束|離開|退下|閉嘴|bye|end|stop|睡覺)$/.test(t);
}

// 去掉所有「@gpt」
function stripAtGpt(text) {
  if (!text) return "";
  return text.replace(/@gpt/gi, "").trim();
}

// 會話控制
function isSessionActive(chatId) {
  const s = chatSession[chatId];
  return !!(s && s.expireAt > Date.now() && s.turnsLeft > 0);
}
function startOrRefreshSession(chatId) {
  if (!chatSession[chatId]) {
    chatSession[chatId] = { expireAt: 0, turnsLeft: SESSION_TURNS };
  }
  chatSession[chatId].expireAt = Date.now() + SESSION_TTL_MS;
  if (chatSession[chatId].turnsLeft <= 0) chatSession[chatId].turnsLeft = SESSION_TURNS;
  console.log(`[${chatId}] 會話啟動/刷新 turns=${chatSession[chatId].turnsLeft}`);
}
function consumeTurn(chatId) {
  if (!chatSession[chatId]) return;
  chatSession[chatId].turnsLeft = Math.max(0, chatSession[chatId].turnsLeft - 1);
  if (chatSession[chatId].turnsLeft === 0) {
    console.log(`[${chatId}] 會話達回合上限，待逾時後安靜`);
  }
}
function endSession(chatId) {
  delete chatSession[chatId];
  console.log(`[${chatId}] 會話結束（手動離場或逾時）`);
}

// 輔助：聊天 id 與記憶
function getChatId(event) {
  return event?.source?.groupId || event?.source?.roomId || event?.source?.userId || "unknown";
}
function pruneExpiredMemory(chatId) {
  const list = chatMemory[chatId] || [];
  chatMemory[chatId] = list.filter(m => Date.now() - m.ts < MEMORY_TTL_MS);
}
function pushMemory(chatId, role, content) {
  if (!chatMemory[chatId]) chatMemory[chatId] = [];
  chatMemory[chatId].push({ role, content, ts: Date.now() });
  const keep = MEMORY_TURNS * 2; // user+assistant 視為一輪
  if (chatMemory[chatId].length > keep) {
    chatMemory[chatId] = chatMemory[chatId].slice(-keep);
  }
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

    // 規則：
    // 1) 含 @gpt → 啟動/刷新會話並回覆（清掉 @gpt 後送模型）
    // 2) 無 @gpt → 只有在會話活躍時才回覆（任何人都可對話）
    let triggered = false;
    let userClean = "";

    if (containsAtGpt(rawText)) {
      const cleaned = stripAtGpt(rawText);
      if (isEndCommand(cleaned)) {
        if (isSessionActive(chatId)) {
          endSession(chatId);
          await replyText(event.replyToken, "收到～GPT 先退下了，需要我再出來就 @gpt 叫我。");
        } else {
          await replyText(event.replyToken, "我本來就在休息狀態喔～要用時再 @gpt 召喚我。");
        }
        continue;
      }
      startOrRefreshSession(chatId);
      userClean = cleaned;
      triggered = true;
      if (!userClean) {
        await replyText(event.replyToken, "我在呢～請在 @gpt 後面接上你的問題。");
        continue;
      }
    } else if (isSessionActive(chatId)) {
      userClean = rawText.trim();
      if (isEndCommand(userClean)) {
        endSession(chatId);
        await replyText(event.replyToken, "好～我先安靜了，需要時再叫我。");
        continue;
      }
      triggered = true;
    }

    if (!triggered) {
      console.log(`[${chatId}] 未觸發（需召喚或會話活躍），忽略。`);
      continue;
    }

    try {
      // 記憶與訊息組裝
      pruneExpiredMemory(chatId);
      const history = (chatMemory[chatId] || []).map(m => ({ role: m.role, content: m.content }));
      const messages = [
        {
          role: "system",
          content:
            // —— 人設（溫暖、隨叫隨到）——
            "你自稱『GPT』。不自我介紹、不說明功能或身分，不提模型/限制/政策" +
            "說話非常不客氣又愛裝可愛，但保持專業。" +
            "回覆使用繁體中文；先簡短問候/承接，再用清楚的條列或短句整理重點；" +
            "回應極簡，除非有要求不然都是兩句話說完。"
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
        await replyText(event.replyToken, "咦，我這邊有點卡卡的…等一下再 @我一次好嗎～");
        continue;
      }

      const data = await gptResponse.json();
      const reply =
        data?.choices?.[0]?.message?.content?.trim() ||
        "我在這裡～把需求直接說清楚，我馬上處理。";

      await replyText(event.replyToken, reply);
      console.log(`[${chatId}] 已回覆：`, reply);

      // 更新記憶
      pushMemory(chatId, "user", userClean);
      pushMemory(chatId, "assistant", reply);

      // 會話維持：刷新壽命、消耗回合
      if (isSessionActive(chatId)) {
        chatSession[chatId].expireAt = Date.now() + SESSION_TTL_MS;
        consumeTurn(chatId);
        if (!isSessionActive(chatId)) endSession(chatId);
      }
    } catch (err) {
      console.error(`[${chatId}] 處理訊息錯誤：`, err);
      await replyText(event.replyToken, "糟了，網路打噴嚏了～再 @gpt 一次我就回來。");
    }
  }
});

// --- LINE 回覆 ---
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
