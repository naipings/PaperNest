import { backend } from "../services/backend";
import { hasTranslationEndpoint, translateEnglishToChinese } from "../services/translation";
import type { Category, LlmAnalysis, LlmAnalysisInput, Paper, Tag } from "../types";
import { now, uuid } from "../types";
import { analysisNeedsBackfill, applyAnalysisFillEmpty, liteAnalysisSeed, mergeAnalyses } from "./importLlmFill";
import { formatTaxonomyImportNote, mergeTaxonomyIntoPaper, taxonomyInputFromPaper } from "./taxonomyClassify";

async function analyzeWithFallback(paper: Paper, input: LlmAnalysisInput): Promise<LlmAnalysis> {
  let lastError: unknown;
  let analysis: LlmAnalysis | undefined;
  if (input.text.trim().length >= 80) {
    try {
      analysis = await backend.analyzePaper(paper.id, { text: input.text, candidateImages: [] });
    } catch (error) {
      lastError = error;
    }
  }
  if (analysisNeedsBackfill(analysis, paper)) {
    const seed = liteAnalysisSeed(paper, analysis, input.text);
    if (seed.trim().length >= 80) {
      try {
        const lite = await backend.analyzePaper(paper.id, { text: seed, candidateImages: [] });
        analysis = mergeAnalyses(analysis, lite);
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (!analysis) throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "LLM 分析失败"));
  return analysis;
}

async function analysisTextForRadarPaper(paper: Paper): Promise<string> {
  if (paper.pdfPath) {
    try {
      const bytes = await backend.readPdf(paper.pdfPath);
      const { extractForImport } = await import("./extractPdfCover");
      const extracted = await extractForImport(bytes, false);
      if (extracted.text.trim().length >= 80) return extracted.text;
    } catch {
      /* 无 PDF 文本时用标题摘要 */
    }
  }
  return liteAnalysisSeed(paper, undefined, "");
}

/** 雷达新入库后，与 PDF 导入共用自动整理开关，向空字段写入 LLM 分析结果。 */
export async function runRadarImportLlmFill(
  paper: Paper,
  opts: {
    autoClassifyOnImport: boolean;
    categories: Category[];
    tags: Tag[];
  },
): Promise<{ paper: Paper; note: string }> {
  const text = await analysisTextForRadarPaper(paper);
  if (text.trim().length < 80) {
    return { paper, note: "摘要过短且无可用 PDF 文本，未执行 LLM 整理" };
  }

  const analysis = await analyzeWithFallback(paper, { text, candidateImages: [] });
  let filled = applyAnalysisFillEmpty(paper, analysis);
  if (filled.abstractEn && !filled.abstractZh && hasTranslationEndpoint()) {
    try {
      filled = { ...filled, abstractZh: await translateEnglishToChinese(filled.abstractEn), updatedAt: now() };
    } catch {
      /* 翻译不可用时保留英文摘要 */
    }
  }

  let taxonomyNote = "";
  if (opts.autoClassifyOnImport) {
    try {
      const taxonomy = await backend.classifyPaperTaxonomy(taxonomyInputFromPaper(filled));
      filled = mergeTaxonomyIntoPaper(filled, taxonomy);
      taxonomyNote = formatTaxonomyImportNote(filled, taxonomy, opts.categories, opts.tags);
    } catch (error) {
      taxonomyNote = `《${filled.titleZh || filled.titleEn}》（自动分类失败：${error instanceof Error ? error.message : String(error)}）`;
    }
  }

  await backend.savePaper(filled);
  for (const item of analysis.vocabulary?.slice(0, 8) ?? []) {
    if (!item.termEn?.trim() || !item.meaningZh?.trim()) continue;
    await backend.saveVocabulary({
      id: uuid(),
      paperId: paper.id,
      termEn: item.termEn,
      meaningZh: item.meaningZh,
      sentenceEn: item.sentenceEn,
      sentenceZh: item.sentenceZh,
      page: item.page,
    });
  }

  const notes = ["已自动 LLM 整理"];
  if (taxonomyNote) notes.push(taxonomyNote);
  return { paper: filled, note: notes.join("；") };
}
