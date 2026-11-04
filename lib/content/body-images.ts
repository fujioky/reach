// lib/content/body-images.ts
// Inline images in a mirror body. reach-upstream writes an X Article's images as
// a paragraph of their own, `![](<url>)`, where they sit in the article; the
// same URL is also one of the mirror's media rows (downloaded to Blob).

const BODY_IMAGE_RE = /^!\[\]\((https?:\/\/\S+)\)$/;

/** The image URL when the paragraph is an inline-image line, else null. */
export function bodyImageUrl(paragraph: string): string | null {
  return BODY_IMAGE_RE.exec(paragraph.trim())?.[1] ?? null;
}

/** Every inline-image URL in a body, in order. */
export function bodyImageUrls(body: string): string[] {
  return body.split(/\n{2,}/).flatMap((p) => bodyImageUrl(p) ?? []);
}
