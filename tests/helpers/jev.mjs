import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tempDir } from "./project.mjs";

// The answer shapes of docs/04 section 9. Each branch test overrides what it needs.
export const BASE_ANSWERS = {
  intake: {
    ambiguity: { type: "noul", noul: 0.2 },
    difficulty: { type: "score", score: 1.1, confidence: 0.85, probabilities: { 0: 0.05, 1: 0.8, 2: 0.15, 3: 0 } },
    needs_plan: { type: "noul", noul: 0.8 },
    task_type: { type: "choice", choice: "feature", confidence: 0.8, probabilities: { feature: 0.9 } },
    ui: { type: "noul", noul: 0.9 },
    new_design: { type: "noul", noul: 0.8 },
  },
  dispatch: {
    difficulty: { type: "score", score: 0.3, confidence: 0.9 },
    fully_specified: { type: "noul", noul: 0.92 },
    blast_radius: { type: "score", score: 0.2, confidence: 0.9 },
  },
  owner: { owner: { type: "choice", choice: "tenonry-typescript", confidence: 0.7, probabilities: { "tenonry-typescript": 0.8 } } },
  risk: {
    risky: { type: "noul", noul: 0.1 },
    blast_radius: { type: "score", score: 0.4, confidence: 0.9 },
    visual_change: { type: "noul", noul: 0.9 },
  },
  quick: { owner: { type: "choice", choice: "tenonry-laravel", confidence: 0.8, probabilities: { "tenonry-laravel": 0.8 } } },
};

// Intake answers for a small, clear request that Jev routes past planning.
export const directIntake = ({ needsPlan = 0.1, difficulty = 0.4, ui = 0.1, newDesign = 0.1 } = {}) => ({
  ...BASE_ANSWERS.intake,
  difficulty: { type: "score", score: difficulty, confidence: 0.9 },
  needs_plan: { type: "noul", noul: needsPlan },
  ui: { type: "noul", noul: ui },
  new_design: { type: "noul", noul: newDesign },
});

const taskType = (choice, confidence) => ({ type: "choice", choice, confidence, probabilities: { [choice]: confidence } });

// Intake answers for a small mechanical change that Jev routes to the quick lane.
export const quickIntake = ({ type = "mechanical", typeConfidence = 0.9, difficulty = 0.3, difficultyConfidence = 0.9, ui = 0.1, needsPlan = 0.1, ambiguity = 0.2 } = {}) => ({
  ...directIntake({ needsPlan, difficulty, ui }),
  ambiguity: { type: "noul", noul: ambiguity },
  difficulty: { type: "score", score: difficulty, confidence: difficultyConfidence },
  task_type: taskType(type, typeConfidence),
});

// Intake answers for a question that Jev routes to a direct answer.
export const answerIntake = ({ typeConfidence = 0.9 } = {}) => ({ ...BASE_ANSWERS.intake, task_type: taskType("investigation", typeConfidence) });

export const dispatchAnswers = ({ difficulty = 0.3, difficultyConfidence = 0.9, specified = 0.92, blast = 0.2, blastConfidence = 0.9 } = {}) => ({
  difficulty: { type: "score", score: difficulty, confidence: difficultyConfidence },
  fully_specified: { type: "noul", noul: specified },
  blast_radius: { type: "score", score: blast, confidence: blastConfidence },
});

export const riskAnswers = (risky, blast, confidence = 0.9, visual = 0.9) => ({
  risky: { type: "noul", noul: risky },
  blast_radius: { type: "score", score: blast, confidence },
  visual_change: { type: "noul", noul: visual },
});

export function writeFixture(overrides = {}) {
  const file = path.join(tempDir("tenonry-jev-"), "fixture.json");
  fs.writeFileSync(file, JSON.stringify({ ...BASE_ANSWERS, ...overrides }, null, 2));
  return file;
}

// A local stand-in for the Decisions API. `handler(req, body, res)` may answer however it likes.
export async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body, text });
      handler(req, body, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/alpha/decisions`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

export const answerWith = (answers, usage = { input_tokens: 10, output_tokens: 2, cost: 0.00001 }) => (req, body, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ id: "dec_1", model: "typesafe/jev-1.13", provider: "typesafe", answers, usage }));
};
