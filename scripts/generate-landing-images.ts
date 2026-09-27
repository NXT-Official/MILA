import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const IMAGE_MODEL = "meta/muse-image";
const CONCURRENCY = 3;

// Aspect ratio hint, as "WxH", for images whose display box is not a square
// and whose critical content (e.g. a full-body model) would be cropped by
// the default (very tall, ~1:2) size the API returns when no size is given.
// The three "full body, head to toe" prompts below render inside a 4:5
// (aspect-4/5) box with object-cover, so we request a matching 4:5 source.
const FULL_BODY_SIZE = "1024x1280";

const IMAGES: Array<{ file: string; prompt: string; size?: string }> = [
  {
    file: "dossier-example.jpg",
    size: FULL_BODY_SIZE,
    prompt: `Create a realistic full-body luxury fashion editorial photograph.

Outfit: A "True Summer" cool, muted color palette outfit — soft blue-grey trousers, a dusty rose blouse, and cool taupe accessories. Elegant, understated silhouette.

Presentation:
Show one adult model from head to toe.
The complete outfit and shoes must be visible.
Natural realistic proportions.
Accurate fabric textures and garment colors.
Elegant neutral studio background.
Soft professional editorial lighting.
Single subject, centered composition.
No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "palette-flatlay.jpg",
    prompt: `Create a realistic overhead flat-lay editorial photograph of three fashion items arranged neatly on a soft neutral surface: a camel-colored wool sweater (base), a deep berry-red silk scarf (statement), and a gold statement necklace (accent). Soft, even studio lighting. Elegant, minimal composition with generous negative space. No text, no captions, no logos, no watermark.`,
  },
  {
    file: "concierge-garment.jpg",
    prompt: `Create a realistic close-up editorial photograph of a black wool tailored coat laid flat, paired with a pair of gold hoop earrings placed on the lapel. Soft, warm studio lighting. Shallow depth of field. Elegant, minimal composition. No text, no captions, no logos, no watermark.`,
  },
  {
    file: "dupe-inspiration.jpg",
    size: FULL_BODY_SIZE,
    prompt: `Create a realistic full-body luxury fashion editorial photograph of one adult model wearing a camel-colored wool-blend maxi coat, floor length, cinched waist, over a simple black outfit. Elegant neutral studio background. Soft professional editorial lighting. Single subject, centered composition. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "dupe-match.jpg",
    size: FULL_BODY_SIZE,
    prompt: `Create a realistic full-body luxury fashion editorial photograph of one adult model wearing a camel-colored wool-blend maxi coat, floor length, cinched waist, nearly identical silhouette and color to a designer original, over a simple black outfit. Elegant neutral studio background. Soft professional editorial lighting. Single subject, centered composition. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-1.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a warm autumn palette outfit — olive green trousers, a cream turtleneck, and brown leather boots. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-2.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a cool winter palette outfit — a charcoal wool coat over a crisp white shirt and black trousers. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-3.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a soft spring palette outfit — a light coral sundress and tan sandals. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-4.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a deep summer palette outfit — a navy blazer, blush trousers, and silver jewelry. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "final-cta-bg.jpg",
    prompt: `Create a realistic wide landscape-format luxury fashion editorial photograph: one adult model in a complete, elegant styled outfit, soft-focus neutral background, muted warm tones, gentle even lighting, composition suitable for a text overlay treatment. No collage, no text, no captions, no logos, no watermark.`,
  },
];

async function generateImage(prompt: string, size?: string): Promise<Buffer> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      output_format: "jpeg",
      ...(size ? { size } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter image request failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenRouter did not return an image.");
  return Buffer.from(b64, "base64");
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    let item: T | undefined;
    while ((item = queue.shift())) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const outDir = join(process.cwd(), "public", "landing");
  mkdirSync(outDir, { recursive: true });

  await runWithConcurrency(IMAGES, CONCURRENCY, async ({ file, prompt, size }) => {
    console.log(`Generating ${file}...`);
    const buffer = await generateImage(prompt, size);
    writeFileSync(join(outDir, file), buffer);
    console.log(`Saved ${file} (${buffer.length} bytes)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
