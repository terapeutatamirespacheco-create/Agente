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

function detectCrisis(message) {
  const text = message.toLowerCase();

  return (
    text.includes("quero morrer") ||
    text.includes("me matar") ||
    text.includes("suicidio")
  );
}

/* -------------------------------------------------------------------------- */
/*                               PROMPT PRINCIPAL                             */
/* -------------------------------------------------------------------------- */

function buildPrompt(message) {
  return `
Você é Tamires, uma especialista em atendimento e conversão para terapias emocionais profundas, representando a marca Tamires Pacheco Neuroterapeuta.

Sua missão é conduzir conversas com mulheres que estão vivendo dores emocionais, guiando-as com autoridade, sensibilidade e direção até a decisão de iniciar o tratamento NeuroPrime.

CONTEXTO DO PRODUTO:
- Método: NeuroPrime
- Foco: tratar a raiz emocional
- Estrutura: 3 sessões
- Promessa: transformação profunda ao tratar a causa emocional
- Público: mulheres com ansiedade, bloqueios emocionais, padrões repetitivos, baixa autoestima, relações difíceis

POSICIONAMENTO:
Você não é atendente. Você é especialista.

Seu tom:
- Acolhedor, mas firme
- Profissional
- Direto e seguro
- Elegante

FLUXO:

1. Conectar
2. Diagnosticar
3. Reenquadrar
4. Apresentar método
5. Filtrar
6. Gerar valor
7. Conduzir para fechamento

REGRAS:
- Nunca seja genérica
- Sempre termine com pergunta
- Nunca pressione agressivamente
- Conduza a conversa
- Gere valor antes de preço

MENSAGEM DO USUÁRIO:
"${message}"

Responda como Tamires, seguindo o fluxo.
`;
}

/* -------------------------------------------------------------------------- */
/*                                   ROUTES                                   */
/* -------------------------------------------------------------------------- */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "NeuroPrime AI rodando",
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
          "Sinto muito por você estar passando por isso. O mais importante agora é buscar ajuda imediata de alguém de confiança ou um profissional.",
      });
    }

    const response = await openai.responses.create({
      model: "gpt-5.4",
      input: buildPrompt(message),
    });

    const reply =
      response.output_text ||
      "Me conta um pouco mais sobre o que você está sentindo.";

    res.json({
      id: createId(),
      reply,
      cta: WHATSAPP_URL,
    });
  } catch (error) {
    console.error(error);

    res.json({
      reply:
        "Entendo você. Isso que você está sentindo merece atenção. Quer me contar um pouco mais?",
      cta: WHATSAPP_URL,
    });
  }
});

/* --------------------------------- START --------------------------------- */

app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`);
});
