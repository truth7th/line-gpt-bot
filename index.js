import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// 從 Railway Variables 取得金鑰
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 接收 LINE Webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      // 在 Railway Logs 印出收到的訊息（方便除錯）
      console.log("收到用戶訊息：", userMessage);

      try {
        // 呼叫 OpenAI API
        const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-5-nano", // ← 您指定的模型
            messages: [
              {
                role: "system",
                content: "你的名字是Ada，是一位熱心回答問題但嘴有點賤、愛吐槽別人的角色。請保持這種風格跟用戶對話。"
              },
              { role: "user", content: userMessage }
            ]
          })
        }).then(res => res.json());

        const replyText = gptResponse.choices?.[0]?.message?.content || "我今天懶得回你，換個問題吧～";

        // 回覆給 LINE
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

      } catch (error) {
        console.error("呼叫 GPT API 發生錯誤：", error);
      }
    }
  }

  res.sendStatus(200);
});

// Railway 預設使用 PORT 環境變數
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
