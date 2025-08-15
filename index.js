// index.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// --- Health checks：給 Railway 探測用 ---
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

// --- 環境變數（請在 Railway → Variables 設定） ---
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- LINE Webhook 入口 ---
// 先立刻回 200，避免 LINE 等太久；事件改以非同步處理
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const events = req.body?.events || [];
  for (const event of events) {
    try {
      if (event.type === "message" && event.message.type === "text") {
        const userMessage = event.message.text;
        console.log("收到用戶訊息：", userMessage);

        // 呼叫 OpenAI（Chat Completions）
        const gpt = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-5-nano", // ← 指定模型
            messages: [
              {
                role: "system",
                content:
                  "你的名字是Ada。你熱心回答問題，但嘴有點賤、愛吐槽別人。請保持毒舌又不失禮貌的語氣，精簡、有梗、直接。"
              },
              { role: "user", content: userMessage }
            ]
          })
        });

        if (!gpt.ok) {
          const msg = await gpt.text();
          console.error("GPT API 錯誤：", gpt.status, msg);
          await replyText(event.replyToken, "伺服器有點鬧脾氣，等我一下再試。");
          continue;
        }

        const data = await gpt.json();
        const replyTextContent =
          data?.choices?.[0]?.message?.content?.trim() ||
          "喔？這問題太省力了吧，換個有難度的來。";

        await replyText(event.replyToken, replyTextContent);
        console.log("已回覆用戶：", replyTextContent);
      } else if (event.type === "message") {
        // 非文字訊息的簡單回覆（避免無回應）
        await replyText(event.replyToken, "先傳文字訊息吧，貼圖我看不出你想說什麼。");
      }
    } catch (err) {
      console.error("處理事件發生例外：", err);
      try {
        await replyText(event.replyToken, "我這邊剛剛差點炸了，再說一次你要什麼。");
      } catch (_) {}
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

// --- 監聽（一定要綁 0.0.0.0，PORT 走環境變數） ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
