import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🧠 MEMÓRIA EM RAM
const memory = {};

function getUserMemory(phone) {
  if (!memory[phone]) {
    memory[phone] = {
      name: null,
      pain: null
    };
  }
  return memory[phone];
}

// 🔐 VERIFICAÇÃO DO WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 📩 RECEBER MENSAGEM
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (msg) {
      const from = msg.from;
      const originalText = msg.text?.body || "";
      const text = originalText.toLowerCase();

      const userMemory = getUserMemory(from);

      // 🧠 CAPTURA NOME
      if (!userMemory.name) {
        const nameMatch = originalText.match(/meu nome é (.*)/i);
        if (nameMatch) {
          userMemory.name = nameMatch[1];
        }
      }

      // 🧠 IDENTIFICA DOR
      if (!userMemory.pain) {
        if (text.includes("ansiedade")) userMemory.pain = "ansiedade";
        if (text.includes("bloqueio")) userMemory.pain = "bloqueio emocional";
        if (text.includes("medo")) userMemory.pain = "medo";
        if (text.includes("insegurança")) userMemory.pain = "insegurança";
      }

      let reply = "";

      // 💰 INTENÇÃO DE COMPRA
      if (
        text.includes("valor") ||
        text.includes("quanto custa") ||
        text.includes("preço") ||
        text.includes("como funciona") ||
        text.includes("quero começar")
      ) {
        reply = `Pelo que você me trouxe, isso já não é algo superficial...

Hoje eu trabalho com dois formatos:

🔹 Neuroprime Basic – R$950  
(indicado para questões mais recentes)

🔹 Neuroprime Premium – R$1850  
(tratamento completo com acompanhamento)

Qual faz mais sentido pra você nesse momento?`;
      }

      // 💰 FECHAMENTO BASIC
      else if (text.includes("basic")) {
        reply = `Perfeito${userMemory.name ? ", " + userMemory.name : ""}.

Esse é o melhor ponto de partida pra você.

👉 Link para iniciar agora:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/FMRN1NG8C6

Assim que confirmar, já começamos.`;
      }

      // 💰 FECHAMENTO PREMIUM
      else if (text.includes("premium")) {
        reply = `Excelente escolha${userMemory.name ? ", " + userMemory.name : ""}.

Esse é o tratamento mais completo.

👉 Link para iniciar agora:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/OHLK4OX0B1

Assim que confirmar, iniciamos seu acompanhamento.`;
      }

      // 🔁 OBJEÇÃO
      else if (text.includes("vou pensar") || text.includes("depois")) {
        reply = `Eu entendo… mas com clareza:

se você continuar adiando, isso tende a se repetir.

A decisão aqui não é sobre terapia…
é sobre continuar como está ou mudar de vez.

Se fizer sentido, eu te ajudo a dar esse próximo passo.`;
      }

      else {
        // 🤖 GPT
        const gpt = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `
Você é Tamires Pacheco, neuroterapeuta especialista.

Nome: ${userMemory.name || "não informado"}
Dor: ${userMemory.pain || "não identificada"}

Seu objetivo é conduzir a pessoa até iniciar o tratamento.

Estilo:
- humano
- direto
- emocional
- frases curtas

Fluxo:
1. acolher
2. identificar dor
3. aprofundar
4. mostrar solução
5. conduzir

Se não tiver nome:
pergunte "como posso te chamar?"
`
              },
              {
                role: "user",
                content: originalText
              }
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`
            }
          }
        );

        reply = gpt.data.choices[0].message.content;

        // 👤 PERSONALIZAÇÃO
        if (userMemory.name) {
          reply = `${userMemory.name}, ${reply}`;
        }

        // 🔥 CTA FINAL
        if (!reply.toLowerCase().includes("link")) {
          reply += "\n\nSe fizer sentido, posso te explicar como iniciar agora.";
        }
      }

      // 📲 INSTAGRAM + SITE (AUTORIDADE ESTRATÉGICA)
      if (
        text.includes("como funciona") ||
        text.includes("quero entender") ||
        text.includes("tem resultado")
      ) {
        reply += `

Inclusive, você pode conhecer melhor meu trabalho aqui:

📲 Instagram:
https://www.instagram.com/tamiresp.neuroterapeuta/

🌐 Site:
https://terapeutatamiresp.com/`;
      }

      // 📤 ENVIO FINAL
      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando...");
});
