import type { PaperExplainSession } from "../types";

const startJobs = new Map<string, Promise<PaperExplainSession>>();
const askJobs = new Map<string, Promise<PaperExplainSession>>();

export function trackExplainStart(paperId: string, run: () => Promise<PaperExplainSession>): Promise<PaperExplainSession> {
  const existing = startJobs.get(paperId);
  if (existing) return existing;
  const job = run().finally(() => {
    if (startJobs.get(paperId) === job) startJobs.delete(paperId);
  });
  startJobs.set(paperId, job);
  return job;
}

export function trackExplainAsk(paperId: string, run: () => Promise<PaperExplainSession>): Promise<PaperExplainSession> {
  const existing = askJobs.get(paperId);
  if (existing) return existing;
  const job = run().finally(() => {
    if (askJobs.get(paperId) === job) askJobs.delete(paperId);
  });
  askJobs.set(paperId, job);
  return job;
}

export function getExplainStartInflight(paperId: string): Promise<PaperExplainSession> | undefined {
  return startJobs.get(paperId);
}

export function getExplainAskInflight(paperId: string): Promise<PaperExplainSession> | undefined {
  return askJobs.get(paperId);
}

/** 测试用：清空进行中任务表 */
export function resetExplainInflightForTests() {
  startJobs.clear();
  askJobs.clear();
}
