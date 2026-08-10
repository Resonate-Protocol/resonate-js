import { describe, expect, it } from "vitest";
import { getUnreportedOutputLatencyMs } from "../../src/audio/platform-output-latency";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAC_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

describe("getUnreportedOutputLatencyMs", () => {
  it.each([
    ["macOS Safari", MAC_SAFARI, {}, 100],
    ["macOS Chrome", MAC_CHROME, {}, 0],
    ["macOS Firefox", MAC_FIREFOX, {}, 0],
    ["iPhone Safari", IPHONE_SAFARI, {}, 100],
    ["iPhone Chrome", IPHONE_CHROME, {}, 100],
    ["Android Chrome", ANDROID_CHROME, {}, 0],
    [
      "iPad desktop mode",
      MAC_SAFARI,
      { platform: "MacIntel", maxTouchPoints: 5 },
      100,
    ],
  ])(
    "%s uses the expected compensation",
    (_name, userAgent, extra, expected) => {
      expect(getUnreportedOutputLatencyMs({ userAgent, ...extra })).toBe(
        expected,
      );
    },
  );

  it("returns 0 outside a browser", () => {
    expect(getUnreportedOutputLatencyMs(undefined)).toBe(0);
  });
});
