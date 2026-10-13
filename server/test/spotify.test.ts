import { describe, expect, it } from "vitest";
import { pickArtwork } from "../src/spotify.js";

describe("pickArtwork", () => {
  it("picks the smallest image that is still at least 200 px wide", () => {
    const images = [
      { url: "640", width: 640 },
      { url: "300", width: 300 },
      { url: "64", width: 64 },
    ];
    expect(pickArtwork(images)).toBe("300");
  });

  it("falls back to the first image, or nothing", () => {
    expect(pickArtwork([{ url: "a", width: 64 }])).toBe("a");
    expect(pickArtwork([])).toBeUndefined();
    expect(pickArtwork(undefined)).toBeUndefined();
  });
});
