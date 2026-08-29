/** Deep 模式 compaction 策略，对齐 @deepseek-ai/dsh-compaction-basic 默认配置 */
export const deepCompactionPolicy = {
  contextWindow: 128_000,
  thresholdRatio: 0.8,
  retainRatio: 0.16,
  maxSummaryTokens: 8192,
  auto: true,
} as const;

export type DeepCompactionPolicy = typeof deepCompactionPolicy;
