import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tempDir } from "./project.mjs";

// The answer shapes of docs/04 section 9. Each branch test overrides what it needs.
export const BASE_ANSWERS = {
  intake: {
    ambiguity: { type: "noul", noul: 0.2 },
    difficulty: { type: "score", score: 1.1, confidence: 0.85, probabilities: { 0: 0.05, 1: 0.8, 2: 0.15, 3: 0 } },
    task_type: { type: "choice", choice: "feature", confidence: 0.8, probabilities: { feature: 0.9 } },
    ui: { type: "noul", noul: 0.9 },
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
  },
};

export const dispatchAnswers = ({ difficulty = 0.3, difficultyConfidence = 0.9, specified = 0.92, blast = 0.2, blastConfidence = 0.9 } = {}) => ({
  difficulty: { type: "score", score: difficulty, confidence: difficultyConfidence },
  fully_specified: { type: "noul", noul: specified },
  blast_radius: { type: "score", score: blast, confidence: blastConfidence },
});

export const riskAnswers = (risky, blast, confidence = 0.9) => ({
  risky: { type: "noul", noul: risky },
  blast_radius: { type: "score", score: blast, confidence },
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
