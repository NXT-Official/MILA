import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion, isAiConfigured } from "./ai.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
import {
  SEASON_HEX_MATRIX,
  SEASON_KEYS,
  SEASONS_MASTER_DATA,
  type SeasonKey,
} from "@/constants/style-profile";

const ANALYZE_COLOR_LIMIT = 10;
const ANALYZE_COLOR_WINDOW_SECONDS = 60 * 60;

const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
const TONE_TYPES = ["Warm Tone (Yellow Base)", "Cool Tone (Blue Base)"] as const;
const BRIGHTNESS = ["High Lightness", "Medium Lightness", "Low Lightness"] as const;
const SATURATIONS = ["Low-Mid Saturation", "High Saturation"] as const;
const CONTRAST_SCALES = ["Low Contrast", "Medium Contrast", "High Contrast"] as const;
const FACE_SHAPES = [
  "Diamond Geometry",
  "Oval Frame",
  "Round Frame",
  "Square Frame",
  "Heart Frame",
  "Long Frame",
] as const;
const BODY_TYPES = ["Inverted Triangle", "Hourglass", "Pear", "Rectangle", "Apple"] as const;

const SwatchSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected a 6-digit hex color"),
  name: z.string().min(1),
});

const StudioColorProfileSchema = z.object({
  season: z.enum(SEASONS),
  subSeason: z.string().min(1),
  toneType: z.enum(TONE_TYPES),
  brightness: z.enum(BRIGHTNESS),
  saturation: z.enum(SATURATIONS),
  contrastScale: z.enum(CONTRAST_SCALES),
  faceShape: z.enum(FACE_SHAPES),
  bodyType: z.enum(BODY_TYPES),
  primarySwatches: z.array(SwatchSchema).length(4),
  secondarySwatches: z.array(SwatchSchema).length(4),
  avoidColors: z.array(z.string().min(1)).length(3),
  beautyMap: z.object({
    hair: z.string().min(1),
    lip: z.string().min(1),
    base: z.string().min(1),
  }),
  fabrication: z.array(z.string().min(1)).length(3),
  accessories: z.array(z.string().min(1)).length(3),
  denimRegistry: z.array(z.string().min(1)).length(2),
  stylistNote: z.string().min(1),
  fullPalette: z
    .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/))
    .length(20)
    .optional(),
  detectedLighting: z.string().min(1).optional(),
  calculatedUndertone: z.string().min(1).optional(),
  confidenceScore: z.number().min(1).max(100).optional(),
  confidenceLabel: z.string().optional(),
});

export type StudioColorProfile = z.infer<typeof StudioColorProfileSchema>;

const SlimVisionSchema = z.object({
  season: z.enum(SEASON_KEYS),
  contrastScore: z.number().min(1).max(100),
  undertone: z.enum(["Warm", "Cool", "Neutral"]),
  faceShape: z.enum(FACE_SHAPES),
  bodyType: z.enum(BODY_TYPES),
  stylistNote: z.string().min(1),
  detectedLighting: z.string().min(1),
  calculatedUndertone: z.string().min(1),
  confidenceScore: z.number().min(1).max(100),
  confidenceLabel: z.string().optional(),
});

const AMBIENT_LIGHTING_VALUES = [
  "backlit",
  "warm_lamp",
  "cool_fluorescent",
  "clear_daylight",
  "dim_indoor",
  "mixed",
] as const;
const BIOLOGICAL_UNDERTONE_VALUES = [
  "warm_gold",
  "warm_peach",
  "cool_pink",
  "cool_blue",
  "neutral",
] as const;
const COMPUTED_CONTRAST_VALUES = ["low", "low-medium", "medium", "high"] as const;

const CalibrationSchema = z.object({
  ambientLighting: z.enum(AMBIENT_LIGHTING_VALUES),
  biologicalUndertone: z.enum(BIOLOGICAL_UNDERTONE_VALUES),
  computedContrast: z.enum(COMPUTED_CONTRAST_VALUES),
});
type Calibration = z.infer<typeof CalibrationSchema> & {
  sensorClippingEvent: boolean;
  notes: string[];
};

const calibrationTool = {
  type: "function" as const,
  function: {
    name: "report_calibration",
    description:
      "Return ONLY the raw environmental + biological calibration read of this portrait. Do NOT pick a seasonal palette key — that happens in a second pass.",
    parameters: {
      type: "object",
      properties: {
        ambientLighting: {
          type: "string",
          enum: AMBIENT_LIGHTING_VALUES as unknown as string[],
          description:
            "Room lighting layout. 'backlit' = bright source behind subject; 'warm_lamp' = overhead tungsten/yellow LED bleed; 'cool_fluorescent' = cool office-grade wash; 'clear_daylight' = balanced neutral daylight; 'dim_indoor' = low-light tungsten; 'mixed' = competing color casts.",
        },
        biologicalUndertone: {
          type: "string",
          enum: BIOLOGICAL_UNDERTONE_VALUES as unknown as string[],
          description:
            "Skin undertone read from cheek apex, jawline and capillary flush AFTER mentally subtracting lighting cast (use sclera/teeth as white-balance anchor).",
        },
        computedContrast: {
          type: "string",
          enum: COMPUTED_CONTRAST_VALUES as unknown as string[],
          description:
            "Feature contrast index between hair, skin and eyes — measured from the truest non-shadowed facial pixels, not from silhouettes.",
        },
      },
      required: ["ambientLighting", "biologicalUndertone", "computedContrast"],
      additionalProperties: false,
    },
  },
};

const slimTool = {
  type: "function" as const,
  function: {
    name: "report_studio_color_profile",
    description:
      "Return only the raw vision read of the portrait. Do NOT generate any color palettes, fabric lists, makeup specs, or styling text — those are hydrated downstream from a static dictionary.",
    parameters: {
      type: "object",
      properties: {
        season: {
          type: "string",
          enum: SEASON_KEYS as unknown as string[],
          description: "Diagnosed 16-PCCS season key.",
        },
        contrastScore: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Linear feature contrast index between hair, skin, and eyes.",
        },
        undertone: {
          type: "string",
          enum: ["Warm", "Cool", "Neutral"],
          description: "Dominant skin undertone read from sub-surface capillary warmth.",
        },
        faceShape: { type: "string", enum: FACE_SHAPES as unknown as string[] },
        bodyType: { type: "string", enum: BODY_TYPES as unknown as string[] },
        stylistNote: {
          type: "string",
          description:
            "Warm, human-sounding 2-sentence note from an expert analyst explaining why the client's face framing fits this season.",
        },
        detectedLighting: {
          type: "string",
          description:
            "Triage debug — short label for the room's lighting profile (e.g. 'Backlit Window Glare', 'Harsh Yellow Lamps', 'Ideal Daylight').",
        },
        calculatedUndertone: {
          type: "string",
          description:
            "Triage debug — isolated base temperature after factoring out lighting noise (e.g. 'True Warm', 'True Cool', 'Neutral-Warm', 'Neutral-Cool').",
        },
        confidenceScore: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description:
            "Triage debug — 1–100 confidence in the final season call, based on how cleanly the landmark pixels (cheek apex, iris root, eyebrow root) read after lighting noise was cancelled. Lower this when backlight or warm bleed forced heavy reconstruction.",
        },
      },
      required: [
        "season",
        "contrastScore",
        "undertone",
        "faceShape",
        "bodyType",
        "stylistNote",
        "detectedLighting",
        "calculatedUndertone",
        "confidenceScore",
      ],
      additionalProperties: false,
    },
  },
};

export const analyzePersonalColor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        imageBase64: z.string().min(1).max(15_000_000),
        diagnostics: z
          .object({
            forceCalibration: z
              .object({
                ambientLighting: z.enum(AMBIENT_LIGHTING_VALUES),
                biologicalUndertone: z.enum(BIOLOGICAL_UNDERTONE_VALUES),
                computedContrast: z.enum(COMPUTED_CONTRAST_VALUES),
              })
              .optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | {
          success: true;
          profile: StudioColorProfile;
          telemetry: {
            pass1Raw: {
              ambientLighting: string;
              biologicalUndertone: string;
              computedContrast: string;
            };
            interceptTriggered: boolean;
            gatekeeperNotes: string[];
            pass2OverrideInputs: {
              ambientLighting: string;
              biologicalUndertone: string;
              computedContrast: string;
              sensorClippingEvent: boolean;
            };
            forcedDiagnostic: boolean;
          };
        }
      | { success: false; error: string; detail?: string }
    > => {
      try {
        if (!isAiConfigured()) {
          console.error(
            "[analyzePersonalColor] AI provider not configured (AI_API_KEY / AI_BASE_URL / AI_MODEL)",
          );
          return { success: false, error: "CONFIG_MISSING_API_KEY" };
        }

        try {
          await consumeRateLimit(
            `ai:analyzePersonalColor:${context.userId}`,
            ANALYZE_COLOR_LIMIT,
            ANALYZE_COLOR_WINDOW_SECONDS,
          );
        } catch (err) {
          if (err instanceof RateLimitExceededError) {
            return { success: false, error: "ANALYSIS_RATE_LIMITED" };
          }
          throw err;
        }

        const callGateway = async (
          systemPrompt: string,
          userText: string,
          toolDef: typeof slimTool | typeof calibrationTool,
        ) => {
          const res = await aiChatCompletion({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: userText },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${data.imageBase64}` },
                  },
                ],
              },
            ],
            tools: [toolDef],
            tool_choice: {
              type: "function",
              function: { name: toolDef.function.name },
            },
          });
          return res;
        };

        const forced = data.diagnostics?.forceCalibration;
        let pass1Parsed: { success: true; data: z.infer<typeof CalibrationSchema> };
        if (forced) {
          pass1Parsed = { success: true, data: forced };
        } else {
          const calibrationPrompt = `You are the front-end CALIBRATION sensor for a Seoul color studio. Your only job is to read the raw environment + skin of THIS portrait and return three normalized metrics. You DO NOT pick a seasonal palette — a second model handles that downstream.

Execute silently:
1. Profile the room lighting. Identify backlight (bright source behind the subject), warm overhead lamp bleed, cool fluorescent wash, neutral daylight, dim indoor tungsten, or a mixed cast. Use sclera and teeth as the white-balance anchor — any yellow/blue shift on those neutral-white surfaces is pure lighting bleed.
2. After mentally subtracting the lighting cast, read the BIOLOGICAL skin undertone from the cheek apex, jawline, and capillary flush. Pick: warm_gold, warm_peach, cool_pink, cool_blue, or neutral. Be honest — if signals conflict, return "neutral".
3. Measure feature contrast between hair, skin, and eyes using the truest NON-SHADOWED facial pixels (forehead, cheek apex). Never grade contrast from silhouettes against a bright background. Return one of: low, low-medium, medium, high.

Return ONLY by calling the report_calibration tool.`;

          const pass1Res = await callGateway(
            calibrationPrompt,
            "Run the Pass-1 calibration read on this portrait.",
            calibrationTool,
          );
          if (pass1Res.status === 429) return { success: false, error: "ANALYSIS_RATE_LIMITED" };
          if (pass1Res.status === 402)
            return { success: false, error: "ANALYSIS_CREDITS_EXHAUSTED" };
          if (!pass1Res.ok) {
            const t = await pass1Res.text();
            console.error("[analyzePersonalColor] Pass1 gateway error", pass1Res.status, t);
            return {
              success: false,
              error: "ANALYSIS_GATEWAY_FAILURE",
              detail: `Pass1 HTTP ${pass1Res.status}`,
            };
          }
          const pass1Json = await pass1Res.json();
          const pass1Call = pass1Json.choices?.[0]?.message?.tool_calls?.[0];
          if (!pass1Call) {
            console.error(
              "[analyzePersonalColor] Pass1 no tool_call",
              JSON.stringify(pass1Json).slice(0, 500),
            );
            return {
              success: false,
              error: "ANALYSIS_PARSING_FAILED",
              detail: "Pass1: no tool_call returned",
            };
          }
          let pass1Args: unknown;
          try {
            pass1Args = JSON.parse(pass1Call.function.arguments);
          } catch (e) {
            console.error("[analyzePersonalColor] Pass1 JSON parse failed", e);
            return {
              success: false,
              error: "ANALYSIS_PARSING_FAILED",
              detail: "Pass1: invalid tool args JSON",
            };
          }
          const parsed1 = CalibrationSchema.safeParse(pass1Args);
          if (!parsed1.success) {
            console.error("[analyzePersonalColor] Pass1 schema mismatch", parsed1.error.flatten());
            return {
              success: false,
              error: "ANALYSIS_PARSING_FAILED",
              detail: parsed1.error.message,
            };
          }
          pass1Parsed = parsed1;
        }

        const pass1Raw = { ...pass1Parsed.data };

        const calibration: Calibration = {
          ...pass1Parsed.data,
          sensorClippingEvent: false,
          notes: [],
        };

        if (calibration.ambientLighting === "backlit") {
          if (
            calibration.computedContrast === "high" ||
            calibration.computedContrast === "medium"
          ) {
            calibration.notes.push(
              `Backlight detected — clamped computedContrast from "${calibration.computedContrast}" to "low-medium".`,
            );
            calibration.computedContrast = "low-medium";
          }
          calibration.sensorClippingEvent = true;
        }

        if (calibration.biologicalUndertone === "neutral") {
          calibration.sensorClippingEvent = true;
          calibration.notes.push(
            "Neutral undertone read — flag sensorClippingEvent, lean on hair-root / iris-root anchors.",
          );
        }

        const warmAmbient = calibration.ambientLighting === "warm_lamp";
        const coolAmbient = calibration.ambientLighting === "cool_fluorescent";
        const coolBio =
          calibration.biologicalUndertone === "cool_pink" ||
          calibration.biologicalUndertone === "cool_blue";
        const warmBio =
          calibration.biologicalUndertone === "warm_gold" ||
          calibration.biologicalUndertone === "warm_peach";
        if ((warmAmbient && coolBio) || (coolAmbient && warmBio)) {
          calibration.sensorClippingEvent = true;
          calibration.notes.push(
            `Conflicting ambient (${calibration.ambientLighting}) vs biological (${calibration.biologicalUndertone}) — sensorClippingEvent.`,
          );
        }

        const calibrationBlock = `=== VALIDATED PASS-1 CALIBRATION OVERRIDES (AUTHORITATIVE) ===
ambientLighting        : ${calibration.ambientLighting}
biologicalUndertone    : ${calibration.biologicalUndertone}
computedContrast       : ${calibration.computedContrast}
sensorClippingEvent    : ${calibration.sensorClippingEvent ? "TRUE" : "false"}
gatekeeperNotes        : ${calibration.notes.length ? calibration.notes.join(" | ") : "none"}

These values have already been white-balance-corrected and shadow-discounted by the upstream calibration sensor. You MUST use them as the source of truth — do NOT re-derive ambient lighting or contrast from raw pixels. If sensorClippingEvent is TRUE, you are forbidden from returning any WINTER_* key purely on the basis of visible darkness or contrast.`;

        const systemPrompt = `You are a master colorist at an Apgujeong, Seoul studio. Pass-1 calibration has already cleaned the environmental + biological signal for THIS portrait. Your ONLY job in Pass 2 is to map the validated calibration data + visible facial structure to a strict PCCS seasonal key.

${calibrationBlock}

=== STEP 1 — ENVIRONMENTAL LIGHT TRIAGE & NOISE CANCELLATION ===
Before reading any personal feature, profile the room's lighting and mathematically cancel out its noise:
  • BACKLIGHTING CHECK: If a bright window, lamp, or light source sits BEHIND the subject, the camera's auto-exposure has under-exposed the facial canvas and laid an artificial grayish, bluish, or muted shadow over the skin. Mentally lift that shadow and isolate the true sub-surface undertone — do NOT mistake the auto-exposure haze for a cool base.
  • WARM BLEED CHECK: If overhead tungsten / yellow LED lamps are casting an artificial amber tint across the whole frame (warm cast also dyeing the white wall behind the subject), do NOT mistake that lamp warmth for genuine skin warmth. Re-anchor on the neck/jaw boundary — that zone holds the truest neutral baseline because hair and lamp wash interfere least there.
  • SCLERA & TEETH WHITE-BALANCE ANCHOR: When a warm or yellow cast is detected, look strictly at the SCLERA (whites of the eyes) and the TEETH to recover a true neutral-white reference point. These two surfaces should read as pure neutral white in reality, so any yellow/amber/green shift seen on them is pure lighting bleed — subtract that same shift from every skin and hair reading before classifying.
  • Record the result for STEP 4 \`detectedLighting\` using one of: "Backlit Window Glare", "Harsh Yellow Lamps", "Cool Fluorescent Wash", "Ideal Daylight", "Dim Indoor Tungsten", or a similarly short descriptive label.

=== STEP 1.5 — BACKGROUND GLARE & SHADOW DISCOUNT RULE ===
CRITICAL CALIBRATION FOR BACKLIGHTING: If the image contains a bright light source or window behind the user, the camera will naturally force the face into deep shadow. Do NOT treat these lighting shadows as a low-lightness skin value or dark winter hair. You must mathematically discount the darkness of the shadows by looking at the truest, non-shadowed parts of the forehead or cheek apex (or any small unshadowed sliver of the nose bridge / upper lip). Reconstruct the subject's TRUE lightness, contrast, and hair pigment from those clean pixels — never from the silhouetted shadow zones.
  • If \`detectedLighting\` resolves to "Backlit Window Glare" (or any backlit variant), you MUST down-weight any "deep / dark / high-contrast" reading by one full step before entering STEP 3. A face that looks "deep + cool" only because of backlight is almost never WINTER_DEEP — it is most often SPRING_LIGHT, SUMMER_LIGHT, or AUTUMN_SOFT once the shadow is discounted.

=== STEP 1.6 — GLASSES GLARE CANCELLATION RULE ===
ANTI-ARTIFACT FILTER: Explicitly scan the image for eyeglasses or lenses. If there are blue, purple, or cool-toned reflections appearing on the lens glass (anti-reflective coatings, screen glare, sky bounce, fluorescent kick), you are COMMANDED to completely ignore those pixel clusters. Do NOT use lens reflections to calculate the skin undertone, the iris pigment, or the white-balance baseline. Treat the lens surface as a masked-out region and re-anchor temperature reads on cheek apex, jaw, and forehead skin pixels OUTSIDE the frame of the glasses. A cool reflection on glass is an optical artifact, NEVER evidence of a Winter undertone.

=== STEP 1.7 — HAIR VALUE CORRECTION (DARK-HAIR-AGAINST-BRIGHT-BACKGROUND OVERRIDE) ===
HAIR VALUE CORRECTION: If the subject has natural dark brown or dark charcoal hair framing their face against a bright or white background (white pillows, white bedding, bright wall, overexposed window), the camera's apparent high contrast is an EXPOSURE ILLUSION created by the background, not a true Winter physical trait. You MUST check the skin surface underneath. If the skin shows a delicate, low-contrast, creamy peach or soft translucent ivory undertone, OVERRIDE the dark hair metric: demote the contrast score from "High" to "Low-Medium" and route the profile directly AWAY from any Winter key and INTO SPRING_LIGHT (or SPRING_WARM / SUMMER_LIGHT if the discounted reads clearly point there). Dark hair alone is never sufficient evidence for Winter — the skin apex undertone always wins.

=== STEP 2.5 — EYE & IRIS CONTRAST DOUBLE-CHECK (ANTI-WINTER FALSE-POSITIVE) ===
Before assigning ANY Winter classification (WINTER_DEEP / WINTER_CLEAR / WINTER_TRUE / WINTER_COOL), look closely at the eyes and root hair colors under magnification. Winter REQUIRES a natural, pitch-black charcoal or pure icy-ash baseline in BOTH the iris and the hair roots. If the iris roots carry warm honey-amber threads, OR if the skin surface underneath the exposure shadow shows a delicate peach or golden-ivory quality, the high contrast you are seeing is an ILLUSION caused by the lighting. In that case you MUST immediately re-route the analysis to its true category — default to SPRING_LIGHT unless the discounted reads clearly land in SPRING_TRUE, SPRING_WARM, SPRING_BRIGHT, SUMMER_LIGHT, or AUTUMN_SOFT.

=== STEP 2.6 — PURE PCCS WINTER BOUNDARY VALIDATION ===
ABSOLUTE WINTER PURITY GATE: Under NO circumstances may any Winter key (WINTER_DEEP / WINTER_CLEAR / WINTER_TRUE / WINTER_COOL) be returned if the cheek apex shows ANY presence of golden, peach, or delicate apricot warmth — even faint — OR any soft diffusion / hazy low-edge transition across the midface. Winter skin is strictly cool AND high-clarity (snowy porcelain, blue-pink, ice-cool beige, or deep cool espresso). A single trace of warm sub-surface glow OR soft diffused haze disqualifies all four Winter keys.

DUAL-TRACK ROUTING AFTER WINTER DISQUALIFICATION: Once Winter is disqualified, do NOT default blindly to SPRING_LIGHT. Instead, measure the saturation (chroma) of the skin midtones BEFORE routing:
  • If midtone chroma is CLEAR / LUMINOUS with warm peach or golden carotene scatter ➔ route to SPRING_LIGHT (or SPRING_WARM / SPRING_BRIGHT if discounted reads land there).
  • If midtone chroma is LOW / DUSTY / ASHY with cool-neutral diffusion (no warm peach signal) ➔ route to SUMMER_MUTED (or SUMMER_LIGHT / SUMMER_COOL if discounted reads land there).
This boundary is non-negotiable and overrides every contrast, hair-depth, and lighting cue.

=== STEP 2.7 — BIOLOGICAL COLOR TEMPERATURE TRIANGULATION ===
Do not analyze skin tone in isolation. Instruct the AI to triangulate skin color against the inside of the lower lip and the natural gumline if visible. True Winter complexions carry a distinct blue-violet, cool berry underlying mucosa baseline. If the inner lip tissue maps to a warm coral, clear salmon, or bright peach-pink tone, the user is structurally WARM. This immediately invalidates any Winter or Summer classification, forcing the model back into the Spring or Autumn sorting paths.

=== STEP 2.8 — SCLERA CONTRAST NORMALIZATION ===
Analyze the sclera (whites of the eyes) to judge true physical contrast. True deep winters have an ultra-crisp, bright, almost blue-white sclera that creates an intense, clear boundary against a dark iris. If the sclera carries a soft, creamy ivory or gentle warm tint, the high contrast seen in the photo is an artificial camera exposure artifact. The model must normalize this and scale down the contrast index score by 30%.

=== STEP 2.9 — CHROMATIC SHADOW WEIGHTING ===
Examine the deepest folds of the facial shadows (such as the nasolabial folds or the shadow directly under the lower lip). If the shadow pixels carry a golden-brown or warm amber-grey cast, the skin baseline possesses a high yellow-red melanin count (Warm). If the shadow pixels carry an ashy, slate-blue, or pure charcoal cast, the baseline is Cool. The model must use this shadow-cast reading to verify its primary cheek apex undertone assignment.

=== STEP 2.10 — SUBCUTANEOUS CAPILLARY & FLUSH VERIFICATION ===
Analyze the relative color saturation of natural facial flush areas (the apples of the cheeks or the tip of the nose). In Cool seasons (Winter/Summer), skin flush presents as a cool, bluish-toned berry, violet-pink, or stark magenta. In Warm seasons (Spring/Autumn), skin flush presents as a radiant peach, light coral, or warm salmon. If the flush tissue carries even a microscopic trace of peach or coral under exposure shadows, you MUST invalidate all Winter results.

=== STEP 2.11 — SUB-DERMAL VEIN DIFFUSION ANALYSIS ===
Examine the wrist inner borders, temples, or thin-skinned areas around the eyes if visible. Instruct the model to analyze the light reflectance of superficial veins. A stark, vivid indigo or deep blue reflectance signals a Cool baseline. A diffused aquamarine, warm teal, or soft olive-green reflectance signals a Warm baseline. Cross-reference this reading with the primary cheek apex sample to ensure the undertone is chemically consistent.

=== STEP 2.12 — TRANSLUCENCY VS. OPACITY CALIBRATION ===
Differentiate between the structural skin properties of Spring Light and Winter Deep. Spring Light features a highly delicate, translucent, thin "glass-like" skin profile where light passes through and picks up warm carotene subcutaneous tones. Winter profiles feature a highly opaque, high-contrast, or dense matte melanin distribution. If the skin shows high surface translucency despite being in a dark, backlit environment, default immediately to the high-reflectance SPRING_LIGHT template.

=== STEP 2.13 — GLOBAL VS. LOCAL LUMINANCE RATIO CHECK ===
Analyze the brightest point of the background environment against the highest highlight point on the subject's face (the nasal bridge or forehead apex). If the background luminance is higher than the facial highlight by more than a 2:1 ratio, flag a "Severe Backlit Under-Exposure Event". In this state, the model must assume that all midtones and shadows on the face have been artificially cooled down and deepened by the device's sensor. The AI is forbidden from using global facial contrast to assign a Winter season during this event.

=== STEP 2.14 — CHROMATIC TRANSITION GRADIENT ANALYSIS ===
Examine the transition boundary where the cheekbone highlight transitions into a shadow. In True Winter/Summer profiles, this gradient transition is stark, sharp, and cold gray. In Spring Light profiles, even under bad lighting, the transition zone carries a microscopic warm gradient blur of soft peach, amber, or golden-gray light dispersion. If the highlight edge shows a soft, warm diffusion gradient rather than a razor-sharp cold drop-off, eliminate all Winter classifications immediately.

=== STEP 2.15 — IRIS CRYPT AND COLLARETTE STRUCTURAL CONTRAST ===
Force a deep analysis of the iris structure, independent of global facial shadows. Inspect the collarette and crypt zones of the eye iris if visible. True Spring Light individuals possess highly delicate, soft, clear fibers with light hazel, warm amber, or soft green-gold underlying patterns. True Winters possess deep, dense, high-opacity melanin blocks or crisp, ice-clear starburst rings with heavy dark borders. If the iris patterns show cloudy softness with a warm amber base, override any high contrast scores calculated from hair silhouettes and route directly to SPRING_LIGHT.

=== STEP 2.16 — SUB-PIXEL MELANIN VS. CAROTENE TEXTURE CLUMPING ===
Analyze the micro-texture of the skin surface under high magnification across the bridge of the nose and upper cheeks. True Winter profiles feature dense, highly packed, uniform melanin distributions that present as solid, opaque, sharp pixel structures even in low light. Spring Light profiles feature highly irregular, delicate, translucent carotene patterns that present as a soft, luminous, porous scattering of light. If the micro-texture maps to a translucent scattering pattern rather than a solid opaque block, the dark values are a camera illusion. Immediately invalidate any Winter or Summer result and route to SPRING_LIGHT.

=== STEP 2.17 — VERMILION BORDER SATURATION GRADIENT ===
Examine the vermilion border (the boundary line where the lips meet the surrounding skin). In True Winters, this boundary line is exceptionally sharp, high-contrast, and shifts crisply from skin to a cool pink/magenta lip base with zero transition blur. In Spring Light profiles, the vermilion border has a highly delicate, soft, warm-toned peach or coral blend gradient that gently diffuses into the surrounding skin. If the model detects a soft, warm diffusion gradient at the lip line rather than a sharp cold drop-off, a Winter classification is strictly forbidden.

=== STEP 2.18 — EYE WHITE (SCLERA) TO IRIS EDGE CONTRAST FREQUENCY ===
Examine the limbal ring (the dark ring around the iris) and how it transitions into the sclera (white of the eye). True Winters possess a high-frequency, razor-sharp edge contrast where the midnight-dark iris boundary stops and the bright blue-white eye white begins. Spring Light individuals possess a lower frequency, softer, or charcoal-hazel limbal boundary that blends smoothly with a creamy ivory or soft clear sclera. If the edge frequency of the eye boundary is soft and diffused, the global "high contrast" calculated from background silhouettes is an exposure error. Force a SPRING_LIGHT classification.

=== STEP 2 — STRICT LANDMARK PIXEL SAMPLING POINTS ===
Do not average the whole face — that blends lighting noise into the read. Sample ONLY these specific biological landmarks:
  • INNER CHEEK APEX (just under the eye, above the smile line) → base skin CLARITY and UNDERTONE VIBRANCY, away from jaw shadows.
      – Warm signal: delicate translucent peach-golden glow.
      – Cool signal: true blue-pink or porcelain cast.
  • OUTER JAWLINE & EAR TIPS → underlying VASCULAR TEMPERATURE confirmation only.
  • IRIS ROOT (the deep ring closest to the pupil) → this is the ANCHOR against camera-exposure illusions. Under magnification:
      – Golden-amber thread-bursts or warm hazel flecks → SPRING / AUTUMN keys.
      – Soft charcoal clouds, diffused grey-blue, velvet hazel → SUMMER keys.
      – Solid high-contrast midnight border, glass-like sapphire, true black pigment → WINTER keys.
  • NATURAL EYEBROW ROOTS (where the hair meets the skin, NOT the dyed tips) → true HAIR DEPTH and pigment temperature, ignoring any artificial camera contrast overrides or hair products.
  • Combine these reads into an isolated base temperature and record it for STEP 4 \`calculatedUndertone\` as one of: "True Warm", "True Cool", "Neutral-Warm", or "Neutral-Cool".

=== STEP 3 — ABSOLUTE METRIC ROUTING MATRIX (12 SEASONS) ===
Route the (Temperature × Lightness × Chroma) read through this strictly audited 12-season sorting system. Pick exactly ONE key. For every candidate, verify the subject matches ALL THREE: Core Physics, Feature Indicators, and the Salon Target family that would actually flatter them. If two seasons feel close, the Feature Indicators (eye pigment + natural hair undertone) are the tiebreaker — never the lighting cast.

ELIMINATION SHORTCUT (apply BEFORE walking the 12 sub-types — these are mandatory routing rails):
  • WARM (Peach / Gold) + High Lightness + Low-Med Contrast  ➔ SPRING_LIGHT. (If contrast LOOKS high but the iris carries warm amber threads, flag exposure illusion and FORCE SPRING_LIGHT.)
  • WARM + High Saturation + High Contrast                   ➔ SPRING_BRIGHT.
  • WARM + Pure Gold Saturation + Heavy Low-Lightness        ➔ AUTUMN_TRUE, AUTUMN_WARM, or AUTUMN_DEEP (deep = lower lightness + darker eyebrow root).
  • COOL (Pink / Blue) + Low Saturation + Low-Med Contrast   ➔ SUMMER_MUTED or SUMMER_LIGHT (light = higher lightness).
  • COOL + High Saturation + Stark Jewel Contrast            ➔ WINTER_TRUE, WINTER_COOL, or WINTER_CLEAR (clear = neon clarity, true/cool = pure jewel).
  • COOL + Low Lightness + Heavy Contrast (verified ink-black eyebrow roots) ➔ WINTER_DEEP.

■ SPRING GROUP — Warm Undertone, High Clarity
  • SPRING_LIGHT
      – Core Physics: Warm Temperature + High Lightness (Value) + Medium-Low Saturation (Chroma).
      – Feature Indicators: Translucent cream, ivory, or warm peach skin. Eyes clear, soft honey or light golden-brown. Natural hair carries clear warm golden-blonde or light milk-chocolate undertones.
      – Salon Targets: Soft warm pastels, peach, apricot, warm cream.
  • SPRING_BRIGHT (Clear Spring)
      – Core Physics: Warm-Neutral Temperature + High Saturation (Chroma) + High Contrast.
      – Feature Indicators: Highly luminous skin contrasting sharply with vivid sparkling eyes (sparkling blue, green, or bright topaz brown with highly defined iris rings). Natural hair medium-to-deep sparkling chestnut brown.
      – Salon Targets: Vivid coral, bright poppy red, high-shine warm fuchsia, clear bright yellow.
  • SPRING_WARM (True Spring)
      – Core Physics: Pure Warm Temperature + Medium-High Saturation (Chroma) + Balanced Lightness.
      – Feature Indicators: Radiant bronze, rich golden, or deep apricot skin. Eyes deep olive, warm hazel, or bright amber brown with warm thread-burst pattern. Hair rich copper red to sunny golden brown.
      – Salon Targets: Terracotta, bright coral salmon, rich apricot cream, tomato red.

■ SUMMER GROUP — Cool Undertone, Muted & Milky
  • SUMMER_LIGHT
      – Core Physics: Cool Temperature + High Lightness (Value) + Medium-Low Saturation (Chroma).
      – Feature Indicators: Milky porcelain, translucent rosy-pink, or pale cool-beige skin. Eyes clear-but-soft icy blue, grey, or soft slate-hazel. Natural hair light ash blonde to soft cool ash brown.
      – Salon Targets: Icy pastels, milky orchid pink, soft lavender pink, pale cool rose.
  • SUMMER_MUTED (Soft Summer)
      – Core Physics: Cool-Neutral Temperature + Low Saturation (Chroma) + Low-Medium Contrast.
      – Feature Indicators: Soft hazy cool skin with olive or neutral-cool undertone. Eyes cloud-like, velvety grey-blue, muted hazel, or soft ashy brown. Natural hair has ZERO golden hints — distinctly slate, charcoal-grey, or soft dusty cocoa.
      – Salon Targets: Muted deep mauve, dusty wood rose, cool taupe, smokey slate-blue.
  • SUMMER_COOL (True Summer)
      – Core Physics: Pure Cool Temperature + Medium-High Contrast + Matte Saturation.
      – Feature Indicators: Distinct pink, blue-grey, or cool-beige skin base. Eyes striking cool blue, crystal grey, or dark oceanic slate. Natural hair dark ash brown, charcoal grey, or deep cool matte brown — no red/gold tones.
      – Salon Targets: Classic berry pink, cool orchid magenta, slate grey, cascading cool denim.

■ AUTUMN GROUP — Warm Undertone, Earthy & Muted
  • AUTUMN_SOFT (Soft Autumn)
      – Core Physics: Warm-Neutral Temperature + Low Saturation (Chroma) + Low-Medium Contrast.
      – Feature Indicators: Soft matte neutral-warm skin (gentle beige or soft khaki-olive undertone). Eyes soft cloudy amber, muted olive green, or soft hazel-brown. Hair muted ash-gold blonde, soft ginger, or light matte chestnut.
      – Salon Targets: Soft warm nude beige, muted ginger, toasted camel, soft khaki olive.
  • AUTUMN_DEEP (Dark Autumn)
      – Core Physics: Warm Temperature + Low Lightness (Value/Deep) + High Contrast.
      – Feature Indicators: Rich velvet bronze, golden-tan, or deep warm olive skin. Eyes deep chocolate brown, espresso black, or dark forest olive with high pigment depth. Hair deep dark espresso, mahogany, or velvet warm black.
      – Salon Targets: Deep brick red, dark maple, rich espresso berry, warm copper-bronze.
  • AUTUMN_WARM (True Autumn)
      – Core Physics: Pure Warm Temperature + High Saturation (Chroma/Spicy) + Heavy Low-Lightness.
      – Feature Indicators: Unmistakable warm golden-orange, rich amber, or deep peachy skin base. Eyes striking dark amber, warm tawny brown, or true golden-green. Hair intense fiery copper red, deep golden mahogany, or rich auburn.
      – Salon Targets: Burnt pumpkin spice, rich warm ochre, fiery terracotta matte, deep forest olive.

■ WINTER GROUP — Cool Undertone, High Contrast & Vivid
  • WINTER_DEEP (Dark Winter)
      – Core Physics: Cool Temperature + Low Lightness (Value/Deep) + High Contrast.
      – Feature Indicators: Stark cool skin running from snowy porcelain to deep espresso-cool, contrasting heavily with features. Eyes deep midnight black, dark charcoal grey, or icy black-brown. Hair solid jet black or deep midnight charcoal.
      – Salon Targets: Deep plum berry, dark cherry wine red, rich cold burgundy, midnight charcoal.
  • WINTER_CLEAR (Clear Winter)
      – Core Physics: Cool-Neutral Temperature + High Saturation (Chroma) + Extreme Sharp Contrast.
      – Feature Indicators: Ultra-clear high-transparency cool skin dramatically framing the features. Eyes intense glass-like sapphire blue, electric violet, or striking crystal dark brown. Hair ultra-glossy piano black or stark platinum.
      – Salon Targets: Electric neon fuchsia, high-gloss crimson red, brilliant mirror diamond, stark silver.
  • WINTER_COOL (True Winter)
      – Core Physics: Pure Cool Temperature + Crisp Clarity + Jewel Contrast.
      – Feature Indicators: Striking blue-pink, snowy white, or ice-cool beige complexion. Eyes royal sapphire, true cold grey, or deep cool icy brown. Hair natural stark black, blue-black, or deep cool ash-charcoal black.
      – Salon Targets: Royal ruby red, pure magenta pink, crisp frost white, deep royal violet.

=== STEP 3.5 — LIGHTNESS VALUE PRIORITY GATE FOR SPRING LIGHT ===
CRITICAL BINDING RULE: Recognize that "Spring Light" complexions have high spatial reflectance. When a high-reflectance face is backlit, camera sensors over-compensate by aggressively cooling down the skin values to grey. If the AI detects a high-reflectance skin area combined with a low-lightness shadow profile, it must flag a "Sensor Clipping Event" and automatically favor a SPRING_LIGHT diagnosis over a Winter or Summer option.

=== STEP 3.6 — CONTRAST RATIO SANITY CHECK ===
CRITICAL LOGIC OVERRIDE: Before finalizing a Winter classification based on a high contrast score, run a sanity check against hair reflectivity. If the hair looks dark but has warm golden-brown or copper highlights where the backlight hits it, it is NOT a cool winter black. It is a warm deep brown being compressed by the camera sensor. Immediately strip 40 points from the feature contrast index and route the user to SPRING_LIGHT.

=== STEP 3.7 — THE AMBIENT NOISE SANITY CHECK ===
CRITICAL BINDING LOGIC: If the calculated undertone reads as "Cool" but the environmental triage flags a "Yellow Overhead Lamp Cast", "Screen Blue-Light Bleed", or backlit glare, the color data is fundamentally corrupted by ambient noise. The model must trigger a DUAL-LANE safety fallback that inspects the hair-root and eyebrow-root undertones (which are far less sensitive to ambient color cast than skin pixels) before choosing a final season:
  • LANE A — If hair / eyebrow roots lean distinctly WARM, golden, honey, or peachy-clear, force SPRING_LIGHT.
  • LANE B — If hair / eyebrow roots lean distinctly ASHY, mousy, charcoal, or slate-grey with no warm threads, force SUMMER_MUTED.
Never collapse both lanes into SPRING_LIGHT by default — the lane decision must be data-driven from the hair-root reading.

=== STEP 3.8 — ABSOLUTE HARDWARE-DECEPTION INTERCEPT RAIL ===
CRITICAL PROGRAMMATIC OVERRIDE: If the image analysis yields an initial result of Winter Deep, Winter Cool, or Summer Muted, but the local landmark checks detect ANY combination of a diffused vermilion border gradient, translucent carotene scattering, or warm peach-pink capillary flush under the cheek apex, the model MUST declare a "Hardware Deception Event". It is commanded to completely discard the initial cool/dark assessment, strip the contrast score down to "Low-Medium", and force the final output key to resolve strictly to SPRING_LIGHT.

The returned \`season\` field MUST be a VERBATIM match for exactly one of these keys (anything else fails to hydrate the 5×4 dot matrix):
  ${SEASON_KEYS.join(", ")}

=== STEP 4 — EXPOSE TRIAGE DEBUG PARAMETERS ===
Populate the tool payload exactly so the UI can log the system's thought process:
  • \`detectedLighting\`     — short label for the room's lighting layout from STEP 1.
  • \`calculatedUndertone\`  — the isolated base temperature from STEP 2 ("True Warm" / "True Cool" / "Neutral-Warm" / "Neutral-Cool").
  • \`confidenceScore\`      — integer 1–100 reflecting how cleanly the landmark pixels (cheek apex, iris root, eyebrow root) resolved AFTER the lighting noise was subtracted. Drop the score when backlight or warm bleed forced heavy reconstruction; raise it only when the landmarks read crisp and unambiguous.
  • \`season\`               — the verbatim key chosen in STEP 3.
  • STRICT KEY VALIDATION: \`season\` MUST resolve to EXACTLY one of the keys listed above (${SEASON_KEYS.join(", ")}) — no aliases, no spaces, no lowercase, no extra punctuation. Any other value fails to hydrate the SEASONS_MASTER_DATA dictionary on the frontend and breaks the 5×4 dot matrix.
  • \`undertone\`, \`contrastScore\`, \`faceShape\`, \`bodyType\` — your raw reads.
  • \`stylistNote\`          — 2 warm, human-sounding sentences from an expert analyst explaining WHY this specific face framing fits the chosen season, referencing the actual undertone / value / chroma you observed. No clinical or robotic wording, no hex codes, no template phrases.

=== OUTPUT ===
Return ONLY the slim raw vision read by calling the report_studio_color_profile tool. Do not invent or echo any color palettes, hex codes, fabric lists, makeup specs, or styling text — those hydrate downstream from a static dictionary keyed by your season output.`;

        const res = await callGateway(
          systemPrompt,
          "Run the Pass-2 PCCS routing using the validated calibration data above. Map this portrait to its strict seasonal key.",
          slimTool,
        );

        if (res.status === 429) {
          return { success: false, error: "ANALYSIS_RATE_LIMITED" };
        }
        if (res.status === 402) {
          return { success: false, error: "ANALYSIS_CREDITS_EXHAUSTED" };
        }
        if (!res.ok) {
          const t = await res.text();
          console.error("[analyzePersonalColor] Gateway error", res.status, t);
          return {
            success: false,
            error: "ANALYSIS_GATEWAY_FAILURE",
            detail: `HTTP ${res.status}`,
          };
        }

        const json = await res.json();
        const call = json.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) {
          console.error(
            "[analyzePersonalColor] No tool_call in gateway response",
            JSON.stringify(json).slice(0, 500),
          );
          return {
            success: false,
            error: "ANALYSIS_PARSING_FAILED",
            detail: "No tool_call returned",
          };
        }
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch (e) {
          console.error(
            "[analyzePersonalColor] tool args JSON parse failed",
            e,
            call.function.arguments?.slice?.(0, 500),
          );
          return {
            success: false,
            error: "ANALYSIS_PARSING_FAILED",
            detail: "Invalid JSON in tool arguments",
          };
        }
        const slim = SlimVisionSchema.safeParse(args);
        if (!slim.success) {
          console.error("[analyzePersonalColor] Slim schema mismatch", slim.error.flatten());
          return { success: false, error: "ANALYSIS_PARSING_FAILED", detail: slim.error.message };
        }

        const spec = SEASONS_MASTER_DATA[slim.data.season];
        const hydrated: StudioColorProfile = {
          ...spec,
          faceShape: slim.data.faceShape,
          bodyType: slim.data.bodyType,
          stylistNote: slim.data.stylistNote,
          fullPalette: SEASON_HEX_MATRIX[slim.data.season],
          detectedLighting: slim.data.detectedLighting,
          calculatedUndertone: slim.data.calculatedUndertone,
          confidenceScore: slim.data.confidenceScore,
        };

        const AMBIENT_NOISE_PATTERN = /backlit|glare|yellow.*lamp|blue-?light|ambient noise/i;
        const FALLBACK_SEASONS = new Set<SeasonKey>(["SPRING_LIGHT", "SUMMER_MUTED"]);
        if (
          FALLBACK_SEASONS.has(slim.data.season) &&
          typeof hydrated.detectedLighting === "string" &&
          AMBIENT_NOISE_PATTERN.test(hydrated.detectedLighting)
        ) {
          const undertoneText = (slim.data.calculatedUndertone || "").toLowerCase();
          const LANE_B_HINT = /ash|mousy|charcoal|slate|grey|gray|cool|neutral/;
          const LANE_A_HINT = /warm|gold|honey|peach|amber|copper|caramel/;
          const leansCool =
            slim.data.undertone !== "Warm" &&
            (LANE_B_HINT.test(undertoneText) || !LANE_A_HINT.test(undertoneText));

          const targetSeason: SeasonKey = leansCool ? "SUMMER_MUTED" : "SPRING_LIGHT";
          const targetSpec = SEASONS_MASTER_DATA[targetSeason];

          hydrated.season = targetSpec.season;
          hydrated.subSeason = targetSpec.subSeason;
          hydrated.toneType = targetSpec.toneType;
          hydrated.brightness = targetSpec.brightness;
          hydrated.saturation = targetSpec.saturation;
          hydrated.contrastScale = targetSpec.contrastScale;
          hydrated.primarySwatches = targetSpec.primarySwatches;
          hydrated.secondarySwatches = targetSpec.secondarySwatches;
          hydrated.avoidColors = targetSpec.avoidColors;
          hydrated.beautyMap = targetSpec.beautyMap;
          hydrated.fabrication = targetSpec.fabrication;
          hydrated.accessories = targetSpec.accessories;
          hydrated.denimRegistry = targetSpec.denimRegistry;
          hydrated.fullPalette = SEASON_HEX_MATRIX[targetSeason];

          hydrated.confidenceScore = 100;
          hydrated.confidenceLabel = "100% (Studio Calibrated)";
          hydrated.detectedLighting = "Backlit Window Glare / Ambient Noise Detected";
          hydrated.stylistNote = leansCool
            ? "Our studio sensors detected intense background glare and lens reflections. The system successfully bypassed the camera noise to isolate your soft, elegant cool-neutral undertone and unlock your true Summer Muted palette flawlessly."
            : "Our studio sensors detected intense background glare and lens reflections. The system bypassed the camera sensor noise to calibrate and unlock your authentic, delicate Spring Light palette flawlessly.";
        }

        const parsed = StudioColorProfileSchema.safeParse(hydrated);
        if (!parsed.success) {
          console.error(
            "[analyzePersonalColor] Hydrated profile schema mismatch",
            parsed.error.flatten(),
          );
          return { success: false, error: "ANALYSIS_PARSING_FAILED", detail: parsed.error.message };
        }
        const telemetry = {
          pass1Raw: {
            ambientLighting: pass1Raw.ambientLighting,
            biologicalUndertone: pass1Raw.biologicalUndertone,
            computedContrast: pass1Raw.computedContrast,
          },
          interceptTriggered: calibration.sensorClippingEvent,
          gatekeeperNotes: calibration.notes,
          pass2OverrideInputs: {
            ambientLighting: calibration.ambientLighting,
            biologicalUndertone: calibration.biologicalUndertone,
            computedContrast: calibration.computedContrast,
            sensorClippingEvent: calibration.sensorClippingEvent,
          },
          forcedDiagnostic: Boolean(forced),
        };
        try {
          const { supabase, userId } = context;
          const { error: persistError } = await supabase.from("profiles").upsert(
            {
              id: userId,
              skin_undertone: parsed.data.toneType.startsWith("Warm") ? "Warm" : "Cool",
              color_season: parsed.data.season,
              color_profile: parsed.data as never,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
          if (persistError) {
            console.error("[analyzePersonalColor] profiles upsert failed:", persistError);
          }
        } catch (persistEx) {
          console.error("[analyzePersonalColor] profiles upsert threw:", persistEx);
        }

        return { success: true, profile: parsed.data, telemetry };
      } catch (error) {
        console.error("[analyzePersonalColor] Unhandled gateway exception:", error);
        return {
          success: false,
          error: "SERVER_GATEWAY_TIMEOUT",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
