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
// 🧠 MEMÓRIA INTELIGENTE
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
      objecoes: [],
      stage: "abertura"
    };
  }
  return memory[phone];
}

// ==============================
// 🔐 VERIFICAÇÃO WEBHOOK
// ==============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ==============================
// 📩 RECEBER MENSAGEM
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
    // 🧠 CAPTURA NOME
    // ==============================
    if (!user.name) {
      const match = originalText.match(/meu nome é (.*)/i);
      if (match) user.name = match[1];
    }

    // ==============================
    // 🧠 IDENTIFICA DOR SUPERFICIAL
    // ==============================
    if (!user.dor_superficial) {
      if (text.includes("ansiedade")) user.dor_superficial = "ansiedade";
      if (text.includes("medo")) user.dor_superficial = "medo";
      if (text.includes("insegurança")) user.dor_superficial = "insegurança";
      if (text.includes("bloqueio")) user.dor_superficial = "bloqueio emocional";
    }

    let reply = "";

    // ==============================
    // 🎯 INTENÇÃO DIRETA DE COMPRA
    // ==============================
    if (
      text.includes("valor") ||
      text.includes("preço") ||
      text.includes("quanto custa")
    ) {
      user.stage = "oferta";

      reply = `Hoje eu trabalho com dois formatos:

🔹 Neuroprime Basic – R$950  
🔹 Neuroprime Premium – R$1850  

Qual faz mais sentido pra você nesse momento?`;
    }

    // ==============================
    // 💰 FECHAMENTO
    // ==============================
    else if (text.includes("basic")) {
      reply = `Perfeito${user.name ? ", " + user.name : ""}.

👉 Link para iniciar:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/FMRN1NG8C6`;
    }

    else if (text.includes("premium")) {
      reply = `Excelente escolha${user.name ? ", " + user.name : ""}.

👉 Link para iniciar:
https://tamires-pacheco-neuroterapia.pay.yampi.com.br/r/OHLK4OX0B1`;
    }

    // ==============================
    // 🔁 OBJEÇÃO
    // ==============================
    else if (text.includes("pensar") || text.includes("depois")) {
      reply = `Eu entendo.

Mas sendo direta:
isso não costuma se resolver sozinho.

Se continuar adiando,
isso tende a se repetir.

A decisão aqui não é sobre terapia.

É sobre continuar como está
ou mudar de verdade.`;
    }

    // ==============================
    // 🤖 GPT INTELIGENTE
    // ==============================
    else {
      const gpt = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
Você é Tamires Pacheco, neuroterapeuta especialista.

Seu objetivo:
conduzir a pessoa até iniciar o tratamento.

Use SEMPRE este fluxo:

1. acolher
2. aprofundar dor
3. identificar padrão emocional
4. mostrar raiz inconsciente
5. conduzir para solução

BASE TERAPÊUTICA:

- A maioria dos problemas não começa no presente
- Existe uma raiz emocional inconsciente
- Enquanto não tratar, o padrão se repete
- Terapias comuns lidam com sintoma
- Aqui tratamos a causa

ESTILO:
- humano
- direto
- emocional
- frases curtas
- sem texto longo

REGRAS:
- sempre fazer perguntas quando faltar informação
- nunca ir direto para venda
- conduzir gradualmente
- gerar leve tensão emocional

DADOS DO USUÁRIO:
Nome: ${user.name || "não informado"}
Dor: ${user.dor_superficial || "não identificada"}
Etapa: ${user.stage}
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

      if (user.name) {
        reply = `${user.name}, ${reply}`;
      }

      // CTA leve automático
      if (!reply.toLowerCase().includes("começar")) {
        reply += "\n\nSe fizer sentido, posso te explicar como iniciar.";
      }
    }

    // ==============================
    // 📤 ENVIO WHATSAPP
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
