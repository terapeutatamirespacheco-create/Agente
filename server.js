import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const WHATSAPP_URL =
  process.env.WHATSAPP_URL ||
  "https://wa.me/5500000000000?text=Quero%20agendar%20uma%20sessao";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* -------------------------------------------------------------------------- */
/*                                  MIDDLEWARE                                */
/* -------------------------------------------------------------------------- */

app.use(cors());
app.use(helmet());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

function createId() {
  return crypto.randomUUID();
}

function normalize(text) {
  return text.toLowerCase();
}

function classify(message) {
  const text = normalize(message);

  if (text.includes("ansiedade") || text.includes("ansioso"))
    return "ansiedade";

  if (text.includes("relacionamento") || text.includes("termino"))
    return "relacionamento";

  if (text.includes("autoestima") || text.includes("inseguro"))
    return "autoestima";

  return "geral";
}

function detectCrisis(message) {
  const text = normalize(message);

  return (
    text.includes("quero morrer") ||
    text.includes("me matar") ||
    text.includes("suicidio")
  );
}

function buildPrompt(message, category) {
  return `
Você é um especialista em acolhimento emocional e conversão para terapia.

REGRAS:
- Seja humano e empático
- Não seja robótico
- Não force venda
- Faça no máximo 1 pergunta
- Leve a pessoa naturalmente para terapia

CONTEXTO:
Usuário disse: "${message}"
Categoria: ${category}

OBJETIVO:
Responder de forma acolhedora e conduzir para terapia.

Se fizer sentido, convide para WhatsApp: ${WHATSAPP_URL}
`;
}

/* -------------------------------------------------------------------------- */
/*                                   ROUTES                                   */
/* -------------------------------------------------------------------------- */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "AI Therapy Server rodando",
  });
});

/* --------------------------------- CHAT ---------------------------------- */

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem obrigatória" });
    }

    if (detectCrisis(message)) {
      return res.json({
        reply:
          "Sinto muito por você estar passando por isso. O mais importante agora é buscar ajuda imediata de alguém de confiança ou um serviço de apoio emocional.",
      });
    }

    const category = classify(message);

    const response = await openai.responses.create({
      model: "gpt-5.4",
      input: buildPrompt(message, category),
    });

    const reply =
      response.output_text ||
      "Entendo você. Quer me contar um pouco mais sobre o que está sentindo?";

    res.json({
      id: createId(),
      category,
      reply,
      cta: WHATSAPP_URL,
    });
  } catch (error) {
    console.error(error);

    res.json({
      reply:
        "Entendi. Isso que você está sentindo merece atenção. Se quiser, posso te explicar como funciona a terapia.",
      cta: WHATSAPP_URL,
    });
  }
});

/* --------------------------------- START --------------------------------- */

app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`);
});
