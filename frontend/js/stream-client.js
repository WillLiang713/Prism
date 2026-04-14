import {
  EventStreamContentType,
  fetchEventSource,
} from "../libs/fetch-event-source/index.js";
import { t } from "./i18n.js";

class HttpStreamError extends Error {
  constructor(status, statusText, detail = "") {
    const summary = detail || statusText || t("请求失败");
    super(`HTTP ${status}: ${summary}`);
    this.name = "HttpStreamError";
    this.status = Number(status) || 0;
    this.statusText = String(statusText || "");
    this.detail = String(detail || "");
  }
}

async function extractErrorDetail(response) {
  let raw = "";

  try {
    raw = (await response.text()) || "";
  } catch (_error) {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
    if (typeof parsed?.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch (_error) {
    // Fall back to raw text below.
  }

  return trimmed;
}

export async function streamJsonSse(url, options = {}) {
  const {
    method = "POST",
    headers = {},
    body,
    signal,
    onChunk,
  } = options;

  await fetchEventSource(url, {
    method,
    headers,
    body,
    signal,
    openWhenHidden: true,
    async onopen(response) {
      if (!response.ok) {
        throw new HttpStreamError(
          response.status,
          response.statusText,
          await extractErrorDetail(response)
        );
      }

      const contentType = String(response.headers.get("content-type") || "");
      if (!contentType.startsWith(EventStreamContentType)) {
        throw new Error(
          t("期望响应类型为 {expected}，实际收到 {actual}", {
            expected: EventStreamContentType,
            actual: contentType || "unknown",
          })
        );
      }
    },
    onmessage(event) {
      const data = String(event?.data || "");
      if (!data || data === "[DONE]") return;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch (error) {
        throw new Error(
          t("解析流式响应失败: {message}", {
            message: error?.message || data,
          })
        );
      }

      if (typeof onChunk === "function") {
        onChunk(chunk, event);
      }
    },
    onerror(error) {
      throw error;
    },
  });
}
