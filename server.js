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

// ==============================
// 🧠 MEMÓRIA
// ==============================
const memory = {};

function getUserMemory(phone) {
  if (!memory[phone]) {
    memory[phone] = {
      name: null,
      dor_superficial: null,
      dor_real: null,
      tempo_problema: null,
      impacto: null,
      tentativas: null,
      prontidao: null,
      stage: "abertura"
    };
  }
  return memory[phone];
}

// ==============================
// 🔐 VERIFICAÇÃO
// ==============================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ==============================
// 🧠 FUNÇÃO GPT
// ==============================
async function gerarResposta(user, mensagem) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é Tamires Pacheco, especialista em desbloqueio emocional profundo.

Seu objetivo é conduzir a pessoa até iniciar o tratamento.

CONTEXTO:
Nome: ${user.name || "não informado"}
Dor superficial: ${user.dor_superficial || "não identificada"}
Tempo do problema: ${user.tempo_problema || "não identificado"}
Impacto: ${user.impacto || "não identificado"}
Etapa: ${user.stage}

ESTRATÉGIA:
- acolher
- aprofundar
- identificar padrão
- mostrar raiz emocional
- conduzir para decisão

REGRAS:
- respostas curtas
- nunca genérica
- sempre investigar
- provocar reflexão leve

FORMATO DE RESPOSTA (OBRIGATÓRIO JSON):
{
  "resposta": "texto para cliente",
  "intencao": "explorar | aprofundar | fechar",
  "produto": "basic | premium | nenhum"
}
`
        },
        {
          role: "user",
          content: mensagem
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}

// ==============================
// 📩 WEBHOOK
// ==============================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const originalText = msg.text?.body || "";
    const text = originalText.toLowerCase();

    const user = getUserMemory(from);

    // ==============================
    // 🧠 CAPTURA SIMPLES
    // ==============================
    if (!user.name) {
      const match = originalText.match(/meu nome é (.*)/i);
      if (match) user.name = match[1];
    }

    if (!user.dor_superficial) {
      if (text.includes("ansiedade")) user.dor_superficial = "ansiedade";
      if (text.includes("medo")) user.dor_superficial = "medo";
      if (text.includes("insegurança")) user.dor_superficial = "insegurança";
      if (text.includes("bloqueio")) user.dor_superficial = "bloqueio emocional";
    }

    if (!user.tempo_problema) {
      if (text.includes("anos") || text.includes("meses")) {
        user.tempo_problema = originalText;
      }
    }

    let reply = "";

    // ==============================
    // 🎯 INTENÇÃO DIRETA
    // ==============================
    if (text.includes("valor") || text.includes("preço")) {
      user.stage = "oferta";

      reply = `Hoje eu trabalho com dois formatos:

🔹 Neuroprime Basic – R$950  
🔹 Neuroprime Premium – R$1850  

Qual faz mais sentido pra você nesse momento?`;
    }

    // ==============================
    // 🤖 GPT
    // ==============================
    else {
      const respostaGPT = await gerarResposta(user, originalText);

      let parsed;

      try {
        parsed = JSON.parse(respostaGPT);
      } catch {
        parsed = { resposta: respostaGPT };
      }

      reply = parsed.resposta;

      // ==============================
      // 🧠 DECISÃO INTELIGENTE
      // ==============================
      if (parsed.produto === "premium") {
        user.stage = "oferta";
      }

      // CTA leve
      if (!reply.toLowerCase().includes("começar")) {
        reply += "\n\nSe fizer sentido, posso te explicar como iniciar.";
      }
    }

    // ==============================
    // 💰 FECHAMENTO
    // ==============================
    if (text.includes("basic")) {
      reply = `Perfeito.

👉 Iniciar:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/FMRN1NG8C6`;
    }

    if (text.includes("premium")) {
      reply = `Excelente escolha.

👉 Iniciar:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/OHLK4OX0B1`;
    }

    // ==============================
    // 📤 ENVIO
    // ==============================
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

    res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando...");
});
