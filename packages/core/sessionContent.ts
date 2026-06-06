import fs from "node:fs";
import { readFileTail } from "./paths";
import type { SessionContentDetail, SessionSource } from "./types";

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTextFromCursorContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as Record<string, unknown>;
    if (typed.type === "text" && typeof typed.text === "string") {
      const tagged = typed.text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
      parts.push(tagged?.[1]?.trim() ?? typed.text.trim());
    }
  }
  const joined = parts.join("\n").trim();
  return joined || undefined;
}

function extractTextFromClaudeContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as Record<string, unknown>;
    if (typed.type === "text" && typeof typed.text === "string") {
      parts.push(typed.text.trim());
    }
    if (typed.type === "tool_use" && typeof typed.name === "string") {
      parts.push(`[工具] ${typed.name}`);
    }
  }
  return parts.join("\n").trim() || undefined;
}

export function readSessionContent(
  transcriptPath: string,
  source: SessionSource,
  displayName: string,
  projectKey: string,
  maxBytes = 512_000,
): SessionContentDetail {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return {
      projectKey,
      displayName,
      source,
      transcriptPath,
      messages: [{ role: "system", text: "暂无 transcript 文件" }],
    };
  }

  const content = readFileTail(transcriptPath, maxBytes);
  const lines = content.split(/\r?\n/).filter(Boolean);
  const messages: SessionContentDetail["messages"] = [];

  for (const line of lines) {
    const row = parseJsonLine(line);
    if (!row) {
      continue;
    }

    if (source === "cursor") {
      const role = row.role;
      const message = row.message as Record<string, unknown> | undefined;
      if (role === "user" || role === "assistant") {
        const text = extractTextFromCursorContent(message?.content);
        if (text) {
          messages.push({ role: role === "user" ? "你" : "Agent", text });
        }
      }
      continue;
    }

    const rowType = row.type;
    const message = row.message as Record<string, unknown> | undefined;
    const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if ((rowType === "user" || rowType === "assistant") && message) {
      const text = extractTextFromClaudeContent(message.content);
      if (text) {
        messages.push({
          role: rowType === "user" ? "你" : "Claude",
          text,
          time: timestamp,
        });
      }
    }
  }

  return {
    projectKey,
    displayName,
    source,
    transcriptPath,
    messages: messages.slice(-40),
  };
}
