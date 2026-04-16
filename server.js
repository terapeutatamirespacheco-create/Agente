import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import sql from "mssql";
import OpenAI from "openai";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const WHATSAPP_URL =
  process.env.WHATSAPP_URL ||
  "https://wa.me/5500000000000?text=Ol%C3%A1%2C%20quero%20agendar%20uma%20sess%C3%A3o";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const ENABLE_OPENAI = String(process.env.ENABLE_OPENAI || "true").toLowerCase() === "true";

if (!process.env.OPENAI_API_KEY && ENABLE_OPENAI) {
  console.warn("[WARN] OPENAI_API_KEY não definido. O chat usará fallback local.");
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "TherapyAI",
  port: Number(process.env.DB_PORT || 1433),
  options: {
    encrypt: String(process.env.DB_ENCRYPT || "false").toLowerCase() === "true",
    trustServerCertificate:
      String(process.env.DB_TRUST_SERVER_CERTIFICATE || "true").toLowerCase() === "true",
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function sanitizeString(value, max = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\0/g, "").slice(0, max);
}

function sanitizeEmail(value) {
  const email = sanitizeString(value, 200).toLowerCase();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return ok ? email : "";
}

function sanitizePhone(value) {
  return sanitizeString(value, 30).replace(/[^\d+()-\s]/g, "");
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function normalizeText(value) {
  return sanitizeString(value, 4000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function classifyLead(message) {
  const text = normalizeText(message);

  const categories = {
    ansiedade: [
      "ansiedade",
      "ansioso",
      "angustia",
      "medo",
      "panico",
      "crise",
      "nervoso",
      "preocupacao",
      "preocupado",
      "taquicardia",
      "sufoco",
    ],
    relacionamento: [
      "relacionamento",
      "casamento",
      "marido",
      "esposa",
      "namorado",
      "namorada",
      "termino",
      "abandono",
      "ciumes",
      "rejeicao",
      "separacao",
      "traição",
      "traicao",
    ],
    autoestima: [
      "autoestima",
      "inseguranca",
      "insuficiente",
      "culpa",
      "vergonha",
      "nao sou capaz",
      "me sinto mal comigo",
      "autoconfianca",
      "comparacao",
    ],
    trauma: [
      "trauma",
      "abuso",
      "violencia",
      "infancia",
      "dor antiga",
      "ferida",
      "gatilho",
      "bloqueio emocional",
      "abandono na infancia",
    ],
    luto: ["luto", "perda", "faleceu", "morte", "saudade intensa"],
    depressivo: [
      "vazio",
      "sem vontade",
      "desanimado",
      "triste o tempo todo",
      "depressao",
      "deprimido",
      "sem energia",
    ],
  };

  let bestCategory = "geral";
  let bestScore = 0;

  for (const [category, terms] of Object.entries(categories)) {
    const score = terms.reduce((acc, term) => (text.includes(term) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  let urgency = 2;
  if (
    containsAny(text, [
      "nao aguento",
      "não aguento",
      "urgente",
      "desesperado",
      "desesperada",
      "muito mal",
      "crise",
      "todos os dias",
      "todo dia",
      "nao consigo trabalhar",
      "não consigo trabalhar",
      "nao consigo dormir",
      "não consigo dormir",
    ])
  ) {
    urgency = 7;
  }

  let pain = 3;
  if (
    containsAny(text, [
      "sofro",
      "dor",
      "peso",
      "vazio",
      "culpa",
      "medo",
      "rejeicao",
      "rejeição",
      "abandono",
      "ansiedade",
      "tristeza",
      "crise",
    ])
  ) {
    pain = 7;
  }

  let openness = 5;
  if (
    containsAny(text, [
      "quero ajuda",
      "preciso de ajuda",
      "quero mudar",
      "quero entender",
      "quero tratar",
      "quero fazer terapia",
      "quero agendar",
      "como funciona",
      "valor",
      "preco",
      "preço",
      "sessao",
      "sessão",
    ])
  ) {
    openness = 8;
  }

  return {
    category: bestCategory,
    painScore: pain,
    urgencyScore: urgency,
    opennessScore: openness,
  };
}

function detectCrisis(message) {
  const text = normalizeText(message);

  const highRiskTerms = [
    "quero morrer",
    "vou me matar",
    "suicidio",
    "suicídio",
    "tirar minha vida",
    "acabar com tudo",
    "nao quero viver",
    "não quero viver",
    "me matar",
    "me machucar",
    "autoagressao",
    "autoagressão",
  ];

  return containsAny(text, highRiskTerms);
}

function buildSystemInstructions() {
  return `
Você é um agente de acolhimento e conversão ética para terapias emocionais.
Seu papel é conversar com empatia, ajudar a pessoa a se reconhecer no problema e conduzir,
de forma natural e respeitosa, para um próximo passo: agendamento, conversa inicial ou WhatsApp.

REGRAS ABSOLUTAS:
- Nunca diagnostique clinicamente.
- Nunca diga que substitui psicólogo, psiquiatra, médico ou atendimento de emergência.
- Nunca force venda agressiva.
- Seja humano, acolhedor, claro e objetivo.
- Sempre use português do Brasil.
- Responda em texto natural, sem markdown e sem listas longas.
- Faça no máximo 1 pergunta por resposta.
- Quando perceber abertura, convide para o próximo passo com um CTA suave.
- Quando a pessoa perguntar preço, responda com elegância e convide para avaliação inicial.
- Se a conversa indicar sofrimento intenso, acolha e sugira apoio profissional adequado.
- Se houver risco de autoagressão ou suicídio, priorize segurança imediata e oriente buscar ajuda urgente local.

ESTILO:
- tom acolhedor
- frases curtas
- sem linguagem robótica
- sem exagero
- sem promessa milagrosa
- sem manipulação

OBJETIVO:
- compreender a dor principal
- conectar essa dor a um processo terapêutico
- aumentar confiança
- converter de forma ética para agendamento ou WhatsApp

CTA PADRÃO:
Quando fizer sentido, convide assim:
"Se quiser, eu posso te explicar como funciona a terapia e te encaminhar para o agendamento."
`.trim();
}

function buildLeadContext(payload) {
  return `
Contexto do visitante:
- nome: ${payload.name || "não informado"}
- email: ${payload.email || "não informado"}
- telefone: ${payload.phone || "não informado"}
- origem: ${payload.source || "site"}
- categoria estimada: ${payload.classification.category}
- dor: ${payload.classification.painScore}/10
- urgência: ${payload.classification.urgencyScore}/10
- abertura: ${payload.classification.opennessScore}/10
- mensagem atual: ${payload.message}
- whatsapp de agendamento: ${WHATSAPP_URL}
`.trim();
}

function crisisMessage() {
  return (
    "Sinto muito que você esteja passando por isso. " +
    "Neste caso, o mais importante agora é buscar ajuda imediata de uma pessoa de confiança " +
    "e de um serviço de emergência ou apoio emocional da sua região. " +
    "Se estiver em risco agora, entre em contato com o serviço de emergência local imediatamente. " +
    "Se conseguir, me diga apenas seu primeiro nome e eu também posso te orientar a procurar apoio profissional com urgência."
  );
}

function fallbackAssistantReply(message, classification) {
  const lower = normalizeText(message);

  if (containsAny(lower, ["preco", "preço", "valor", "quanto custa"])) {
    return (
      "Posso te explicar como funciona a terapia e te direcionar para o agendamento. " +
      "Normalmente o ideal é começar por uma avaliação inicial para entender sua necessidade com cuidado. " +
      `Você pode seguir por aqui: ${WHATSAPP_URL}`
    );
  }

  if (classification.opennessScore >= 8) {
    return (
      "Faz sentido você querer cuidar disso agora. " +
      "Pelo que você descreveu, existe um sofrimento real e vale olhar para isso com profundidade. " +
      `Se quiser, eu posso te encaminhar direto para o agendamento: ${WHATSAPP_URL}`
    );
  }

  switch (classification.category) {
    case "ansiedade":
      return (
        "O que você está sentindo parece estar te consumindo por dentro, e isso costuma pesar muito no corpo e na mente. " +
        "Trabalhar essa raiz emocional pode ajudar bastante. " +
        "Você sente que isso tem afetado mais seus relacionamentos, seu sono ou sua rotina?"
      );
    case "relacionamento":
      return (
        "Quando uma dor emocional aparece nos relacionamentos, ela costuma tocar em feridas profundas como rejeição, medo ou abandono. " +
        "Isso pode ser tratado com cuidado. " +
        "Hoje, o que mais te machuca nisso tudo?"
      );
    case "autoestima":
      return (
        "Quando a autoestima fica abalada, a pessoa começa a carregar um peso silencioso por muito tempo. " +
        "Esse processo pode ser trabalhado de forma profunda e respeitosa. " +
        "Você sente que isso te trava mais nas decisões, nos relacionamentos ou no trabalho?"
      );
    case "trauma":
      return (
        "Quando existe uma ferida emocional antiga, muita coisa do presente pode parecer maior do que realmente é. " +
        "Isso não significa fraqueza, significa que existe algo importante pedindo cuidado. " +
        "Você quer que eu te explique como a terapia pode ajudar nesse processo?"
      );
    default:
      return (
        "Entendi. Pelo que você descreve, isso merece um olhar mais cuidadoso e profundo. " +
        "A terapia pode ajudar a organizar o que você sente e trabalhar a raiz emocional desse sofrimento. " +
        "Se quiser, eu posso te explicar como funciona e te encaminhar para o agendamento."
      );
  }
}

async function generateAssistantReply(payload) {
  if (detectCrisis(payload.message)) {
    return crisisMessage();
  }

  if (!ENABLE_OPENAI || !openai) {
    return fallbackAssistantReply(payload.message, payload.classification);
  }

  try {
    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions: buildSystemInstructions(),
      input: buildLeadContext(payload),
    });

    const text = sanitizeString(response.output_text || "", 5000);
    return text || fallbackAssistantReply(payload.message, payload.classification);
  } catch (error) {
    console.error("[OPENAI_ERROR]", error?.message || error);
    return fallbackAssistantReply(payload.message, payload.classification);
  }
}

function actionFromClassification(classification) {
  if (classification.urgencyScore >= 7 && classification.opennessScore >= 7) {
    return "offer_booking";
  }

  if (classification.opennessScore >= 8) {
    return "offer_whatsapp";
  }

  if (classification.painScore >= 7) {
    return "continue_diagnosis";
  }

  return "nurture";
}

/* -------------------------------------------------------------------------- */
/*                                 SQL SERVER                                 */
/* -------------------------------------------------------------------------- */

async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(sqlConfig);
  return pool;
}

async function initDatabase() {
  const db = await getPool();

  await db.request().batch(`
IF OBJECT_ID('dbo.Leads', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Leads (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NULL,
    Email NVARCHAR(200) NULL,
    Phone NVARCHAR(50) NULL,
    Source NVARCHAR(100) NOT NULL DEFAULT 'site',
    Stage NVARCHAR(50) NOT NULL DEFAULT 'new',
    Category NVARCHAR(100) NULL,
    PainScore INT NOT NULL DEFAULT 0,
    UrgencyScore INT NOT NULL DEFAULT 0,
    OpennessScore INT NOT NULL DEFAULT 0,
    Notes NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID('dbo.Conversations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Conversations (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    LeadId UNIQUEIDENTIFIER NULL,
    VisitorId NVARCHAR(100) NOT NULL,
    Status NVARCHAR(50) NOT NULL DEFAULT 'open',
    LastUserMessage NVARCHAR(MAX) NULL,
    LastAssistantMessage NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Conversations_Leads FOREIGN KEY (LeadId) REFERENCES dbo.Leads(Id)
  );
END;

IF OBJECT_ID('dbo.Messages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Messages (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    ConversationId UNIQUEIDENTIFIER NOT NULL,
    Role NVARCHAR(50) NOT NULL,
    Content NVARCHAR(MAX) NOT NULL,
    MetadataJson NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Messages_Conversations FOREIGN KEY (ConversationId) REFERENCES dbo.Conversations(Id)
  );
END;

IF OBJECT_ID('dbo.Events', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Events (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    LeadId UNIQUEIDENTIFIER NULL,
    ConversationId UNIQUEIDENTIFIER NULL,
    EventType NVARCHAR(100) NOT NULL,
    PayloadJson NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Events_Leads FOREIGN KEY (LeadId) REFERENCES dbo.Leads(Id),
    CONSTRAINT FK_Events_Conversations FOREIGN KEY (ConversationId) REFERENCES dbo.Conversations(Id)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Leads_Email' AND object_id = OBJECT_ID('dbo.Leads'))
BEGIN
  CREATE INDEX IX_Leads_Email ON dbo.Leads (Email);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Leads_Phone' AND object_id = OBJECT_ID('dbo.Leads'))
BEGIN
  CREATE INDEX IX_Leads_Phone ON dbo.Leads (Phone);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Conversations_VisitorId' AND object_id = OBJECT_ID('dbo.Conversations'))
BEGIN
  CREATE INDEX IX_Conversations_VisitorId ON dbo.Conversations (VisitorId);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Messages_ConversationId_CreatedAt' AND object_id = OBJECT_ID('dbo.Messages'))
BEGIN
  CREATE INDEX IX_Messages_ConversationId_CreatedAt ON dbo.Messages (ConversationId, CreatedAt);
END;
  `);

  console.log("[DB] Estrutura validada.");
}

async function insertEvent({ leadId = null, conversationId = null, eventType, payload }) {
  const db = await getPool();
  const id = createId();

  await db
    .request()
    .input("Id", sql.UniqueIdentifier, id)
    .input("LeadId", sql.UniqueIdentifier, leadId)
    .input("ConversationId", sql.UniqueIdentifier, conversationId)
    .input("EventType", sql.NVarChar(100), eventType)
    .input("PayloadJson", sql.NVarChar(sql.MAX), JSON.stringify(payload || {}))
    .query(`
      INSERT INTO dbo.Events (Id, LeadId, ConversationId, EventType, PayloadJson)
      VALUES (@Id, @LeadId, @ConversationId, @EventType, @PayloadJson)
    `);

  return id;
}

async function upsertLead({ name, email, phone, source, notes, classification }) {
  const db = await getPool();

  const existing = await db
    .request()
    .input("Email", sql.NVarChar(200), email || null)
    .input("Phone", sql.NVarChar(50), phone || null)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Leads
      WHERE (@Email IS NOT NULL AND Email = @Email)
         OR (@Phone IS NOT NULL AND Phone = @Phone)
      ORDER BY UpdatedAt DESC
    `);

  if (existing.recordset.length > 0) {
    const lead = existing.recordset[0];

    await db
      .request()
      .input("Id", sql.UniqueIdentifier, lead.Id)
      .input("Name", sql.NVarChar(200), name || lead.Name)
      .input("Email", sql.NVarChar(200), email || lead.Email)
      .input("Phone", sql.NVarChar(50), phone || lead.Phone)
      .input("Source", sql.NVarChar(100), source || lead.Source)
      .input("Category", sql.NVarChar(100), classification.category)
      .input("PainScore", sql.Int, classification.painScore)
      .input("UrgencyScore", sql.Int, classification.urgencyScore)
      .input("OpennessScore", sql.Int, classification.opennessScore)
      .input("Notes", sql.NVarChar(sql.MAX), notes || lead.Notes)
      .query(`
        UPDATE dbo.Leads
        SET Name = @Name,
            Email = @Email,
            Phone = @Phone,
            Source = @Source,
            Category = @Category,
            PainScore = @PainScore,
            UrgencyScore = @UrgencyScore,
            OpennessScore = @OpennessScore,
            Notes = @Notes,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);

    return lead.Id;
  }

  const id = createId();

  await db
    .request()
    .input("Id", sql.UniqueIdentifier, id)
    .input("Name", sql.NVarChar(200), name || null)
    .input("Email", sql.NVarChar(200), email || null)
    .input("Phone", sql.NVarChar(50), phone || null)
    .input("Source", sql.NVarChar(100), source || "site")
    .input("Category", sql.NVarChar(100), classification.category)
    .input("PainScore", sql.Int, classification.painScore)
    .input("UrgencyScore", sql.Int, classification.urgencyScore)
    .input("OpennessScore", sql.Int, classification.opennessScore)
    .input("Notes", sql.NVarChar(sql.MAX), notes || null)
    .query(`
      INSERT INTO dbo.Leads
      (
        Id, Name, Email, Phone, Source, Category,
        PainScore, UrgencyScore, OpennessScore, Notes
      )
      VALUES
      (
        @Id, @Name, @Email, @Phone, @Source, @Category,
        @PainScore, @UrgencyScore, @OpennessScore, @Notes
      )
    `);

  return id;
}

async function getOrCreateConversation({ visitorId, leadId = null }) {
  const db = await getPool();

  const existing = await db
    .request()
    .input("VisitorId", sql.NVarChar(100), visitorId)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Conversations
      WHERE VisitorId = @VisitorId
      ORDER BY UpdatedAt DESC
    `);

  if (existing.recordset.length > 0) {
    const conversation = existing.recordset[0];

    if (leadId && !conversation.LeadId) {
      await db
        .request()
        .input("Id", sql.UniqueIdentifier, conversation.Id)
        .input("LeadId", sql.UniqueIdentifier, leadId)
        .query(`
          UPDATE dbo.Conversations
          SET LeadId = @LeadId,
              UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @Id
        `);
    }

    return conversation.Id;
  }

  const id = createId();

  await db
    .request()
    .input("Id", sql.UniqueIdentifier, id)
    .input("LeadId", sql.UniqueIdentifier, leadId)
    .input("VisitorId", sql.NVarChar(100), visitorId)
    .query(`
      INSERT INTO dbo.Conversations (Id, LeadId, VisitorId)
      VALUES (@Id, @LeadId, @VisitorId)
    `);

  return id;
}

async function insertMessage({ conversationId, role, content, metadata }) {
  const db = await getPool();
  const id = createId();

  await db
    .request()
    .input("Id", sql.UniqueIdentifier, id)
    .input("ConversationId", sql.UniqueIdentifier, conversationId)
    .input("Role", sql.NVarChar(50), role)
    .input("Content", sql.NVarChar(sql.MAX), content)
    .input("MetadataJson", sql.NVarChar(sql.MAX), JSON.stringify(metadata || {}))
    .query(`
      INSERT INTO dbo.Messages (Id, ConversationId, Role, Content, MetadataJson)
      VALUES (@Id, @ConversationId, @Role, @Content, @MetadataJson)
    `);

  await db
    .request()
    .input("ConversationId", sql.UniqueIdentifier, conversationId)
    .input("Content", sql.NVarChar(sql.MAX), content)
    .query(`
      UPDATE dbo.Conversations
      SET UpdatedAt = SYSUTCDATETIME(),
          ${role === "user" ? "LastUserMessage = @Content" : "LastAssistantMessage = @Content"}
      WHERE Id = @ConversationId
    `);

  return id;
}

async function listMessages(conversationId, top = 50) {
  const db = await getPool();

  const result = await db
    .request()
    .input("ConversationId", sql.UniqueIdentifier, conversationId)
    .input("Top", sql.Int, top)
    .query(`
      SELECT TOP (@Top)
             Id, ConversationId, Role, Content, MetadataJson, CreatedAt
      FROM dbo.Messages
      WHERE ConversationId = @ConversationId
      ORDER BY CreatedAt ASC
    `);

  return result.recordset;
}

async function getLeadById(id) {
  const db = await getPool();
  const result = await db
    .request()
    .input("Id", sql.UniqueIdentifier, id)
    .query(`SELECT TOP 1 * FROM dbo.Leads WHERE Id = @Id`);
  return result.recordset[0] || null;
}

/* -------------------------------------------------------------------------- */
/*                                 MIDDLEWARE                                 */
/* -------------------------------------------------------------------------- */

app.set("trust proxy", 1);

app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : [FRONTEND_URL],
    credentials: true,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(express.json({ limit: "1mb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Muitas requisições. Tente novamente em instantes.",
  },
});

app.use("/api", apiLimiter);

app.use((req, res, next) => {
  req.requestId = createId();
  next();
});

/* -------------------------------------------------------------------------- */
/*                                   ROUTES                                   */
/* -------------------------------------------------------------------------- */

app.get("/", async (_req, res) => {
  res.json({
    ok: true,
    name: "therapy-ai-server",
    version: "1.0.0",
    status: "online",
    appUrl: APP_URL,
    time: nowIso(),
  });
});

app.get("/api/health", async (_req, res) => {
  try {
    const db = await getPool();
    await db.request().query("SELECT 1 AS ok");
    res.json({
      ok: true,
      database: "connected",
      openai: ENABLE_OPENAI && !!process.env.OPENAI_API_KEY,
      model: OPENAI_MODEL,
      time: nowIso(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Falha no health check",
      details: error?.message || String(error),
    });
  }
});

app.get("/api/config", async (_req, res) => {
  res.json({
    ok: true,
    whatsappUrl: WHATSAPP_URL,
    model: OPENAI_MODEL,
    openaiEnabled: ENABLE_OPENAI && !!process.env.OPENAI_API_KEY,
  });
});

app.post("/api/leads", async (req, res) => {
  try {
    const name = sanitizeString(req.body?.name, 200);
    const email = sanitizeEmail(req.body?.email);
    const phone = sanitizePhone(req.body?.phone);
    const source = sanitizeString(req.body?.source || "site", 100);
    const message = sanitizeString(req.body?.message, 4000);

    if (!name && !email && !phone) {
      return res.status(400).json({
        ok: false,
        error: "Informe pelo menos nome, email ou telefone.",
      });
    }

    const classification = classifyLead(message);

    const leadId = await upsertLead({
      name,
      email,
      phone,
      source,
      notes: message || null,
      classification,
    });

    await insertEvent({
      leadId,
      eventType: "lead_created_or_updated",
      payload: {
        source,
        classification,
        ip: getClientIp(req),
      },
    });

    const lead = await getLeadById(leadId);

    res.status(201).json({
      ok: true,
      lead: {
        id: lead.Id,
        name: lead.Name,
        email: lead.Email,
        phone: lead.Phone,
        source: lead.Source,
        stage: lead.Stage,
        category: lead.Category,
        painScore: lead.PainScore,
        urgencyScore: lead.UrgencyScore,
        opennessScore: lead.OpennessScore,
        createdAt: lead.CreatedAt,
        updatedAt: lead.UpdatedAt,
      },
    });
  } catch (error) {
    console.error("[POST /api/leads]", error);
    res.status(500).json({
      ok: false,
      error: "Não foi possível salvar o lead.",
      details: error?.message || String(error),
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const visitorId = sanitizeString(req.body?.visitorId || "", 100) || createId();
    const conversationIdFromClient = sanitizeString(req.body?.conversationId || "", 100);
    const name = sanitizeString(req.body?.name, 200);
    const email = sanitizeEmail(req.body?.email);
    const phone = sanitizePhone(req.body?.phone);
    const source = sanitizeString(req.body?.source || "site", 100);
    const message = sanitizeString(req.body?.message, 4000);

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "A mensagem é obrigatória.",
      });
    }

    const classification = classifyLead(message);

    let leadId = null;
    if (name || email || phone) {
      leadId = await upsertLead({
        name,
        email,
        phone,
        source,
        notes: message,
        classification,
      });
    }

    let conversationId = null;

    if (conversationIdFromClient && isValidUuid(conversationIdFromClient)) {
      conversationId = conversationIdFromClient;
    } else {
      conversationId = await getOrCreateConversation({ visitorId, leadId });
    }

    await insertMessage({
      conversationId,
      role: "user",
      content: message,
      metadata: {
        visitorId,
        source,
        classification,
        requestId: req.requestId,
      },
    });

    const assistantReply = await generateAssistantReply({
      name,
      email,
      phone,
      source,
      message,
      classification,
      visitorId,
      conversationId,
      leadId,
    });

    await insertMessage({
      conversationId,
      role: "assistant",
      content: assistantReply,
      metadata: {
        action: actionFromClassification(classification),
        whatsappUrl: WHATSAPP_URL,
        requestId: req.requestId,
      },
    });

    await insertEvent({
      leadId,
      conversationId,
      eventType: "chat_reply_generated",
      payload: {
        classification,
        action: actionFromClassification(classification),
        visitorId,
        source,
      },
    });

    res.json({
      ok: true,
      visitorId,
      conversationId,
      classification,
      action: actionFromClassification(classification),
      reply: assistantReply,
      cta: {
        type:
          classification.opennessScore >= 8 || classification.urgencyScore >= 7
            ? "whatsapp"
            : "continue_chat",
        url:
          classification.opennessScore >= 8 || classification.urgencyScore >= 7
            ? WHATSAPP_URL
            : null,
      },
    });
  } catch (error) {
    console.error("[POST /api/chat]", error);
    res.status(500).json({
      ok: false,
      error: "Falha ao processar a conversa.",
      details: error?.message || String(error),
    });
  }
});

app.get("/api/conversations/:conversationId/messages", async (req, res) => {
  try {
    const conversationId = sanitizeString(req.params.conversationId, 100);

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({
        ok: false,
        error: "conversationId inválido.",
      });
    }

    const messages = await listMessages(conversationId, 100);

    res.json({
      ok: true,
      conversationId,
      messages: messages.map((m) => ({
        id: m.Id,
        role: m.Role,
        content: m.Content,
        metadata: (() => {
          try {
            return m.MetadataJson ? JSON.parse(m.MetadataJson) : {};
          } catch {
            return {};
          }
        })(),
        createdAt: m.CreatedAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/conversations/:id/messages]", error);
    res.status(500).json({
      ok: false,
      error: "Falha ao listar mensagens.",
      details: error?.message || String(error),
    });
  }
});

app.get("/api/faq", async (_req, res) => {
  res.json({
    ok: true,
    items: [
      {
        question: "Como funciona a terapia?",
        answer:
          "O processo começa com uma conversa inicial para entender sua dor emocional, seu momento atual e qual caminho faz mais sentido para você.",
      },
      {
        question: "Em quanto tempo eu começo a perceber diferença?",
        answer:
          "Isso varia de pessoa para pessoa, mas muita gente percebe mais clareza emocional e alívio já nas primeiras sessões.",
      },
      {
        question: "É online ou presencial?",
        answer:
          "Isso depende da estrutura do atendimento do terapeuta. O ideal é confirmar no momento do agendamento.",
      },
      {
        question: "Como agendar?",
        answer: `Você pode iniciar por aqui: ${WHATSAPP_URL}`,
      },
    ],
  });
});

/* -------------------------------------------------------------------------- */
/*                              ERROR HANDLERS                                */
/* -------------------------------------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Rota não encontrada.",
    path: req.originalUrl,
  });
});

app.use((error, req, res, _next) => {
  console.error("[UNHANDLED_ERROR]", {
    requestId: req.requestId,
    message: error?.message,
    stack: error?.stack,
  });

  res.status(500).json({
    ok: false,
    error: "Erro interno do servidor.",
    requestId: req.requestId,
  });
});

/* -------------------------------------------------------------------------- */
/*                                  STARTUP                                   */
/* -------------------------------------------------------------------------- */

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`[SERVER] Rodando em ${APP_URL}`);
      console.log(`[SERVER] Porta ${PORT}`);
      console.log(`[SERVER] OpenAI ${ENABLE_OPENAI && !!process.env.OPENAI_API_KEY ? "ON" : "OFF"}`);
    });
  } catch (error) {
    console.error("[STARTUP_ERROR]", error);
    process.exit(1);
  }
}

start();
