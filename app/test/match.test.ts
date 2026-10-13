import { describe, expect, it } from "vitest";
import { cleanTitle, isConfidentMatch, songsterrQuery, songsterrSearchPage } from "../src/match";

const r = (title: string, artist: string, songId = 1) => ({ title, artist, songId });

describe("songsterrQuery", () => {
  it("drops Spotify title noise and extra artists", () => {
    expect(songsterrQuery({ title: "Come Together - Remastered 2009", artist: "The Beatles" })).toBe("The Beatles Come Together");
    expect(songsterrQuery({ title: "Song (feat. X) [Live]", artist: "A, B" })).toBe("A Song");
    expect(cleanTitle("(Intro)")).toBe("(Intro)");
  });

  it("builds Songsterr's search page", () => {
    const p = songsterrSearchPage("a b");
    expect(p.songId).toBe(0);
    expect(p.url).toBe("https://www.songsterr.com/?pattern=a%20b");
  });
});

describe("isConfidentMatch", () => {
  const track = { title: "Come Together - Remastered 2009", artist: "The Beatles" };

  it("accepts the same title and artist, ignoring case, accents and 'The'", () => {
    expect(isConfidentMatch(track, r("Come Together", "Beatles"))).toBe(true);
    expect(isConfidentMatch({ title: "Canción", artist: "Beyoncé & Jay-Z" }, r("Cancion", "Jay Z"))).toBe(true);
  });

  it("rejects a different song or artist", () => {
    expect(isConfidentMatch(track, r("Something", "The Beatles"))).toBe(false);
    expect(isConfidentMatch(track, r("Come Together", "Aerosmith"))).toBe(false);
  });

  it("never treats a search page as a match", () => {
    expect(isConfidentMatch(track, r("Come Together", "The Beatles", 0))).toBe(false);
  });

  it("tolerates a version suffix on one side only for real words", () => {
    expect(isConfidentMatch({ title: "Hurt", artist: "Johnny Cash" }, r("Hurt (Acoustic)", "Johnny Cash"))).toBe(true);
    expect(isConfidentMatch({ title: "Go", artist: "X" }, r("Go Away", "X"))).toBe(false);
  });
});
