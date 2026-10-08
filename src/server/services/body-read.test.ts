import { describe, expect, test } from "bun:test";
import { BODIES, HAIR_COLORS, HAIR_LENGTHS, SKIN_DEPTHS } from "@/constants/style-profile";
import {
  BODY_SCAN_SYSTEM_PROMPT,
  BODY_SCAN_TOOL,
  BodyScanReplySchema,
  CHECK_IN_SYSTEM_PROMPT,
  CHECK_IN_TOOL,
  CHECK_IN_USER_TEXT,
  CheckInReadSchema,
  CheckInReplySchema,
  MAX_PHOTO_CHARS,
  createProviderCallLedger,
  isPhotoTooLarge,
  photoDigest,
  photoPart,
} from "./body-read";

type Schema = {
  type: string;
  properties: Record<string, { type: string; enum?: string[] }>;
  required: string[];
  additionalProperties: boolean;
};

const schemaOf = (tool: { function: { parameters: Record<string, unknown> } }) =>
  tool.function.parameters as unknown as Schema;

describe("report_check_in tool", () => {
  test("is strict: six required properties and nothing else", () => {
    expect(CHECK_IN_TOOL.function.name).toBe("report_check_in");
    const schema = schemaOf(CHECK_IN_TOOL);
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "bodyFullLength",
        "faceVisible",
        "hairColor",
        "hairLength",
        "silhouette",
        "skinDepth",
      ].sort(),
    );
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.additionalProperties).toBe(false);
  });

  test("its enums are the stored values, plus not_visible for the silhouette", () => {
    const { properties } = schemaOf(CHECK_IN_TOOL);
    expect(properties.skinDepth.enum).toEqual([...SKIN_DEPTHS]);
    expect(properties.hairColor.enum).toEqual([...HAIR_COLORS]);
    expect(properties.hairLength.enum).toEqual([...HAIR_LENGTHS]);
    expect(properties.silhouette.enum).toEqual([...BODIES, "not_visible"]);
    expect(properties.faceVisible.type).toBe("boolean");
    expect(properties.bodyFullLength.type).toBe("boolean");
  });
});

describe("report_body_scan tool", () => {
  test("is strict and asks for the silhouette part only", () => {
    expect(BODY_SCAN_TOOL.function.name).toBe("report_body_scan");
    const schema = schemaOf(BODY_SCAN_TOOL);
    expect(Object.keys(schema.properties).sort()).toEqual(["bodyFullLength", "silhouette"]);
    expect([...schema.required].sort()).toEqual(["bodyFullLength", "silhouette"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.silhouette.enum).toEqual([...BODIES, "not_visible"]);
  });
});

describe("prompts", () => {
  test("the check-in prompt names each field and the photo order", () => {
    expect(CHECK_IN_SYSTEM_PROMPT).toContain(
      "You read everyday photos for a personal stylist. Report only what report_check_in asks.",
    );
    for (const field of ["skinDepth", "hairColor", "hairLength", "silhouette"]) {
      expect(CHECK_IN_SYSTEM_PROMPT).toContain(field);
    }
    expect(CHECK_IN_SYSTEM_PROMPT).toContain("not_visible");
    expect(CHECK_IN_USER_TEXT).toBe(
      "Photo 1 is her face. Photo 2, when present, is a full-length photo.",
    );
  });

  test("both prompts refuse to judge season, undertone, gender, age, height, weight or looks", () => {
    const refusal =
      "Never judge or mention season, undertone, gender, age, height, weight or attractiveness.";
    expect(CHECK_IN_SYSTEM_PROMPT).toContain(refusal);
    expect(BODY_SCAN_SYSTEM_PROMPT).toContain(refusal);
    expect(BODY_SCAN_SYSTEM_PROMPT).toContain("report_body_scan");
    expect(BODY_SCAN_SYSTEM_PROMPT).not.toMatch(/hairColor|skinDepth|hairLength/);
  });
});

describe("photoDigest", () => {
  test("is the first 16 hex of the SHA-256 of the base64 (golden vectors)", () => {
    expect(photoDigest(["aGVsbG8="])).toBe("333d6b3a3c1f5db6");
    expect(photoDigest(["aGVsbG8=", "d29ybGQ="])).toBe("f5004db718d2d98f");
  });

  test("tells photo pairs apart by content, order and split", () => {
    expect(photoDigest(["YQ==", "Yg=="])).not.toBe(photoDigest(["Yg==", "YQ=="]));
    expect(photoDigest(["YWJj", "ZA=="])).not.toBe(photoDigest(["YW", "JjZA=="]));
    expect(photoDigest(["YQ=="])).toBe(photoDigest(["YQ=="]));
    expect(photoDigest(["YQ=="])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("photo size", () => {
  test("1,800,000 characters is allowed; one more is too large", () => {
    expect(MAX_PHOTO_CHARS).toBe(1_800_000);
    expect(isPhotoTooLarge("A".repeat(1_800_000))).toBe(false);
    expect(isPhotoTooLarge("A".repeat(1_800_001))).toBe(true);
    expect(isPhotoTooLarge(undefined)).toBe(false);
    expect(isPhotoTooLarge(null)).toBe(false);
  });

  test("a photo is sent to the model as a jpeg data URI part", () => {
    expect(photoPart("aGVsbG8=")).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,aGVsbG8=" },
    });
  });
});

describe("reply schemas", () => {
  const reply = {
    skinDepth: "Medium",
    hairColor: "Dark brown",
    hairLength: "Long",
    silhouette: "Pear",
    faceVisible: true,
    bodyFullLength: true,
  };

  test("a reply in the tool's exact values parses unchanged", () => {
    expect(CheckInReplySchema.parse(reply)).toEqual(reply);
  });

  test("case and spacing variants map to the stored value; anything else is refused", () => {
    const parsed = CheckInReplySchema.parse({
      ...reply,
      hairColor: "dark  brown",
      hairLength: "bald shaved",
      silhouette: "Not visible",
      faceVisible: "true",
      bodyFullLength: "false",
    });
    expect(parsed).toMatchObject({
      hairColor: "Dark brown",
      hairLength: "Bald/Shaved",
      silhouette: "not_visible",
      faceVisible: true,
      bodyFullLength: false,
    });
    expect(CheckInReplySchema.safeParse({ ...reply, hairColor: "Teal" }).success).toBe(false);
    expect(CheckInReplySchema.safeParse({ ...reply, faceVisible: "maybe" }).success).toBe(false);
    expect(CheckInReplySchema.safeParse({ ...reply, skinDepth: undefined }).success).toBe(false);
  });

  test("the body scan reply reads the silhouette and full-length flag", () => {
    expect(
      BodyScanReplySchema.parse({ silhouette: "inverted triangle", bodyFullLength: true }),
    ).toEqual({ silhouette: "Inverted Triangle", bodyFullLength: true });
    expect(BodyScanReplySchema.safeParse({ silhouette: "Pear" }).success).toBe(false);
  });

  test("both replies are strict: a key the tool never asked for is refused (M-6)", () => {
    expect(CheckInReplySchema.safeParse({ ...reply, season: "Autumn" }).success).toBe(false);
    expect(
      BodyScanReplySchema.safeParse({ silhouette: "Pear", bodyFullLength: true, weight: 60 })
        .success,
    ).toBe(false);
  });

  test("a stored read is strict too: only the five fields Mila wrote", () => {
    const read = {
      skinDepth: "Medium",
      hairColor: "Dark brown",
      hairLength: "Long",
      silhouette: null,
      bodyPhotoUsable: null,
    };
    expect(CheckInReadSchema.parse(read)).toEqual(read);
    expect(CheckInReadSchema.safeParse({ ...read, undertone: "Warm" }).success).toBe(false);
  });
});

describe("provider call ledger (R-2 amended, fix round 1 M-2)", () => {
  test("no call made: the hourly slot may be handed back", () => {
    expect(createProviderCallLedger().mayRelease()).toBe(true);
  });

  test("a reply, an unusable reply (502) or a timeout (504) keeps the slot", async () => {
    for (const result of [
      { ok: true as const, args: {} },
      { ok: false as const, status: 502 },
      { ok: false as const, status: 504 },
    ]) {
      const ledger = createProviderCallLedger();
      await ledger.call(async () => result);
      expect(ledger.mayRelease()).toBe(false);
    }
  });

  test("only a refusal she cannot cause hands the slot back: 401, 402, 404, 429, 500, 503", async () => {
    for (const status of [401, 402, 404, 429, 500, 503]) {
      const ledger = createProviderCallLedger();
      await ledger.call(async () => ({ ok: false as const, status }));
      expect(ledger.mayRelease()).toBe(true);
    }
  });

  test("a refusal she can cause (a bad photo: 400, 403, 413, 422) or anything else keeps the slot", async () => {
    for (const status of [400, 403, 408, 413, 418, 422, 501]) {
      const ledger = createProviderCallLedger();
      await ledger.call(async () => ({ ok: false as const, status }));
      expect(ledger.mayRelease()).toBe(false);
    }
  });

  test("one kept call among released ones keeps the slot", async () => {
    const ledger = createProviderCallLedger();
    await ledger.call(async () => ({ ok: false as const, status: 503 }));
    await ledger.call(async () => ({ ok: false as const, status: 400 }));
    expect(ledger.mayRelease()).toBe(false);
  });

  test("a call that threw, or is still running, counts as billed", async () => {
    const threw = createProviderCallLedger();
    await expect(
      threw.call(async () => {
        throw new Error("socket closed");
      }),
    ).rejects.toThrow("socket closed");
    expect(threw.mayRelease()).toBe(false);

    const pending = createProviderCallLedger();
    let finish: (value: { ok: false; status: number }) => void = () => {};
    const call = pending.call(() => new Promise((resolve) => (finish = resolve)));
    expect(pending.mayRelease()).toBe(false);
    finish({ ok: false, status: 503 });
    await call;
    expect(pending.mayRelease()).toBe(true);
  });
});
