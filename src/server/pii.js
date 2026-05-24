const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

export function redactPii(value = "") {
  return String(value)
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(PHONE_RE, "[redacted-phone]")
    .replace(CARD_RE, "[redacted-card]");
}

export function preview(value = "", length = 360) {
  const redacted = redactPii(value).replace(/\s+/g, " ").trim();
  return redacted.length > length ? `${redacted.slice(0, length)}...` : redacted;
}

export function estimateTokens(text = "") {
  return Math.max(1, Math.ceil(String(text).length / 4));
}
