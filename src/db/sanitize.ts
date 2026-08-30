export function sanitizeOperationalError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[REDACTED]@")
    .replace(/\b(?:sk|gsk)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500) || "Unknown operational error";
}
