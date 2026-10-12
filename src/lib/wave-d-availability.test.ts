import { describe, expect, test } from "bun:test";
import { isWaveDMissing, WAVE_D_MISSING_CODES } from "./wave-d-availability";

describe("WAVE_D_MISSING_CODES", () => {
  test("names every way PostgREST and Postgres say a Wave D object is not there yet", () => {
    // Golden vector, copied verbatim by mobile.
    expect([...WAVE_D_MISSING_CODES].sort()).toEqual(
      ["42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"].sort(),
    );
  });
});

describe("isWaveDMissing", () => {
  test("a missing column, table or function means the migration is not applied", () => {
    for (const code of ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"]) {
      expect(isWaveDMissing({ code, message: "" })).toBe(true);
    }
  });

  test("anything else is a real error", () => {
    for (const code of ["42501", "23505", "23514", "PGRST116", "PGRST301", "", "P0001"]) {
      expect(isWaveDMissing({ code, message: "" })).toBe(false);
    }
  });

  test("never throws on odd input", () => {
    for (const value of [null, undefined, "42703", 42703, {}, [], new Error("boom")]) {
      expect(isWaveDMissing(value)).toBe(false);
    }
    expect(isWaveDMissing({ code: 42703 })).toBe(false);
  });

  test("reads the code off an Error too", () => {
    const error = Object.assign(new Error("column profiles.hair_color does not exist"), {
      code: "42703",
    });
    expect(isWaveDMissing(error)).toBe(true);
  });
});
