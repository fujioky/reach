// lib/video/sanitize.ts
// Strip upstream hostnames from visitor-facing error text.

export function sanitizePublicError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/https?:\/\/[^\s/]+(?:\/[^\s]*)?/g, '[已隐藏]')
    .replace(/\b(?:from|via)\s+[^\s·]+/gi, 'from [已隐藏]');
}