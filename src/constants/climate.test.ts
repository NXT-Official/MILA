import { describe, expect, test } from "bun:test";
import { climateForWeatherCode } from "./climate";

describe("climateForWeatherCode", () => {
  test("maps WMO weather and applies wind only to cloudy conditions", () => {
    expect(climateForWeatherCode(65)).toMatchObject({
      icon: "rain",
      condition: "Rain",
      description: "Heavy Rain",
    });
    expect(climateForWeatherCode(2, 25)).toMatchObject({ icon: "wind", condition: "Windy" });
    expect(climateForWeatherCode(71, 25)).toMatchObject({ icon: "snow", condition: "Snow" });
  });
});
