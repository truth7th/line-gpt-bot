import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// Health checks（給 Railway 探測）
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/webhook", async (req, res) => {
  // 先立即回 200，避免 LINE 等太久
  res.sendStatus(200);

  const events = req.body?.events || [];
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      console.log("收到用戶訊息：", userMessage);

      try {
        const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-5-nano",
            messages: [
              { role: "system", content: "你的名字是Ada，是一位熱心回答問題但嘴有點賤、愛吐槽別人的角色。請保持這種風格與用戶對話。" },
              { role: "user", content: userMessage }
            ]
          })
        }).then(r => r.json());

        const replyText = gptResponse?.choices?.[0]?.message?.content
          || "喔？這問題太省力了吧，換個有難度的來。";

        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: "text", text: replyText }]
          })
        });

        console.log("已回覆用戶：", replyText);
      } catch (err) {
        console.error("處理訊息失敗：", err);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
