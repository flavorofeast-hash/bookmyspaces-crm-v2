-- Photos that carry an AI-generation/editing mark (e.g. the Google Gemini sparkle in the corner) are flagged,
-- so nobody mistakes them for untouched photos of the property. The owner decides whether they may be used.
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS ai_mark boolean NOT NULL DEFAULT false;
UPDATE crm.media SET ai_mark = true,
  description = COALESCE(description || ' ', '') || 'Shows the Google Gemini AI sparkle mark (bottom-right): this image was made or edited with AI. Approve only if it truly shows the property as it is.'
WHERE source_url LIKE 'https://www.bookmyspaces.in/images/%' AND NOT ai_mark
  AND filename IN ('cafe-main.webp','cafe-rooftop.webp','gallery-1.webp','gallery-2.webp','gallery-4.webp','room-decor.webp','rooftop-dining.webp','hall-event.webp',
                   'rooftop-evening.webp','room-deluxe-1.webp','room-deluxe-2.webp','room-deluxe-3.webp','skyline-serenity.webp','hero-main.webp');
