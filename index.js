import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Client } from "@line/bot-sdk";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// LINE Bot 設定
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// 對話歷史（僅保存 3 輪）
let history = [];
let sessionActive = false;

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text.trim();

      // ✅ 退出模式：當有人輸入 "掰掰GPT"
      if (userMessage.includes("掰掰GPT")) {
        sessionActive = false;
        history = [];
        await lineClient.replyMessage(event.replyToken, {
          type: "text",
          text: "好的，我先休息一下，有需要再叫我吧～",
        });
        continue;
      }

      // ✅ 觸發模式：群組中有人 @gpt
      if (userMessage.includes("@gpt")) {
        sessionActive = true;

        // 清理輸入（去掉 @gpt）
        const userClean = userMessage.replace("@gpt", "").trim() || "你好";

        const messages = [
          {
            role: "system",
            content:
              "你自稱『GPT』。你是一個溫暖又俐落的小幫手，說話簡潔有條理，" +
              "但語氣親切自然，像朋友一樣隨叫隨到。" +
              "不要自我介紹，不要說明功能或身分，除非使用者明確詢問。" +
              "回覆請直接切題，可以簡單承接再用條列或短句表達重點。" +
              "不要主動插話，只在被呼叫或對話持續時回應。" +
              "一律使用繁體中文。",
          },
          ...history,
          { role: "user", content: userClean },
        ];

        const gptReply = await callGPT(messages);

        // 保存到歷史，最多 3 筆
        history.push({ role: "user", content: userClean });
        history.push({ role: "assistant", content: gptReply });
        if (history.length > 6) history = history.slice(-6);

        await lineClient.replyMessage(event.replyToken, {
          type: "text",
          text: gptReply,
        });
        continue;
      }

      // ✅ 如果對話模式啟動，且沒有 @gpt，也繼續回應
      if (sessionActive) {
        const userClean = userMessage;

        const messages = [
          {
            role: "system",
            content:
              "你自稱『GPT』。你是一個溫暖又俐落的小幫手，說話簡潔有條理，" +
              "但語氣親切自然，像朋友一樣隨叫隨到。" +
              "不要自我介紹，不要說明功能或身分，除非使用者明確詢問。" +
              "回覆請直接切題，可以簡單承接再用條列或短句表達重點。" +
              "不要主動插話，只在被呼叫或對話持續時回應。" +
              "一律使用繁體中文。",
          },
          ...history,
          { role: "user", content: userClean },
        ];

        const gptReply = await callGPT(messages);

        // 保存到歷史，最多 3 筆
        history.push({ role: "user", content: userClean });
        history.push({ role: "assistant", content: gptReply });
        if (history.length > 6) history = history.slice(-6);

        await lineClient.replyMessage(event.replyToken, {
          type: "text",
          text: gptReply,
        });
      }
    }
  }

  res.status(200).send("OK");
});

// 呼叫 OpenAI GPT
async function callGPT(messages) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      messages: messages,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "嗯？我好像聽不懂呢。";
}

app.listen(process.env.PORT || 3000, () => {
  console.log("LINE GPT bot is running.");
});
