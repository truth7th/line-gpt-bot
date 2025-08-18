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

// --- LINE Webhook ---
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const events = req.body?.events || [];
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      console.log("收到訊息：", userMessage);

      // --- 關鍵字觸發（gpt）---
      if (!userMessage.toLowerCase().includes("gpt")) {
        console.log("未觸發關鍵字，忽略");
        return; // 不回覆
      }

      try {
        // 呼叫 OpenAI GPT
        const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-5-nano",
            messages: [
              {
                role: "system",
                content:
                  "你的名字是Ada。你熱心回答問題，但嘴有點賤、愛吐槽別人。請保持毒舌又不失禮貌的語氣。"
              },
              { role: "user", content: userMessage }
            ]
          })
        });

        const data = await gptResponse.json();
        const replyTextContent =
          data?.choices?.[0]?.message?.content?.trim() ||
          "你喊我幹嘛？沒事別打擾我。";

        await replyText(event.replyToken, replyTextContent);
        console.log("已回覆用戶：", replyTextContent);
      } catch (err) {
        console.error("處理訊息時發生錯誤：", err);
        await replyText(event.replyToken, "伺服器剛剛打了個盹，等下再試。");
      }
    }
  }
});

// --- 封裝 LINE 回覆 ---
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
