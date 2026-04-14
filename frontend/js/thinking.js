import { t } from './i18n.js';

function stripMarkdownForThinkingSummary(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeThinkingText(thinkingText) {
  return String(thinkingText || "")
    .replace(/\r/g, "")
    .replace(/\*\*\*\*/g, "**\n\n**")
    .replace(/____/g, "__\n\n__")
    .replace(
      /([.!?。！？])(\*\*[^*\n]+\*\*|__[^_\n]+__|#{1,6}\s+[^\n]+)/g,
      "$1\n\n$2"
    );
}

function isStandaloneThinkingChunk(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return (
    /^\*\*[^*]+\*\*$/.test(trimmed) ||
    /^__[^_]+__$/.test(trimmed) ||
    /^#{1,6}\s+.+$/.test(trimmed)
  );
}

export function appendThinkingChunk(existingText, nextChunk) {
  const prev = String(existingText || "");
  const next = String(nextChunk || "");
  if (!prev) return next;
  if (!next) return prev;
  if (isStandaloneThinkingChunk(next) && !/\n\s*$/.test(prev)) {
    return `${prev}\n\n${next}`;
  }
  if (/[\s\n]$/.test(prev) || /^[\s\n]/.test(next)) return prev + next;
  if (isStandaloneThinkingChunk(prev) && isStandaloneThinkingChunk(next)) {
    return `${prev}\n\n${next}`;
  }
  if (
    (prev.endsWith("**") && next.startsWith("**")) ||
    (prev.endsWith("__") && next.startsWith("__"))
  ) {
    return `${prev}\n\n${next}`;
  }
  return prev + next;
}

export function extractThinkingSummary(thinkingText) {
  const normalizedText = normalizeThinkingText(thinkingText);
  const raw = normalizedText.trim();
  if (!raw) return "";
  const hasTrailingNewline = /\n\s*$/.test(normalizedText);

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let latestTitle = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLastLine = index === lines.length - 1;
    if (isLastLine && !hasTrailingNewline) continue;
    if (line.startsWith("```")) continue;

    let candidate = "";
    if (/^#{1,6}\s+/.test(line)) {
      candidate = line.replace(/^#{1,6}\s+/, "");
    } else if (/^\*\*[^*]+\*\*$/.test(line) || /^__[^_]+__$/.test(line)) {
      candidate = line.replace(/^\*\*|\*\*$|^__|__$/g, "");
    } else {
      const plain = stripMarkdownForThinkingSummary(line);
      const looksLikeTitle =
        plain.length >= 4 &&
        plain.length <= 72 &&
        !/[。！？.!?：:]$/.test(plain);
      if (looksLikeTitle) candidate = plain;
    }

    candidate = stripMarkdownForThinkingSummary(candidate);
    if (!candidate) continue;
    latestTitle = candidate;
  }

  if (latestTitle) return latestTitle;
  return "";
}

export function formatThinkingCompleteLabel(thinkingTimeSec = null) {
  if (!Number.isFinite(thinkingTimeSec)) return t("思考完成");
  return t("思考完成，用时 {seconds} 秒", {
    seconds: thinkingTimeSec.toFixed(1),
  });
}

export function buildThinkingLabel(
  thinkingText,
  isComplete = false,
  previousLabel = "",
  thinkingTimeSec = null
) {
  if (isComplete && String(thinkingText || "").trim()) {
    return formatThinkingCompleteLabel(thinkingTimeSec);
  }
  const summary = extractThinkingSummary(thinkingText);
  if (summary) return summary;
  return previousLabel || t("思考中");
}
