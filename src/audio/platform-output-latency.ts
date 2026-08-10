type NavigatorInfo = Pick<Navigator, "userAgent"> &
  Partial<Pick<Navigator, "platform" | "maxTouchPoints">>;

const APPLE_WEBKIT_UNREPORTED_OUTPUT_LATENCY_MS = 100;

// All iOS browsers use WebKit, while this output path is Safari-only on macOS.
export function getUnreportedOutputLatencyMs(
  navigatorInfo: NavigatorInfo | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): number {
  if (!navigatorInfo) return 0;

  const { userAgent } = navigatorInfo;
  // Keep detection local because importing helpers from index.ts would create a cycle.
  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigatorInfo.platform === "MacIntel" &&
      (navigatorInfo.maxTouchPoints ?? 0) > 1);
  if (isIOS) return APPLE_WEBKIT_UNREPORTED_OUTPUT_LATENCY_MS;

  const isMacSafari =
    /Macintosh/i.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|Edg|OPR|Firefox/i.test(userAgent);
  return isMacSafari ? APPLE_WEBKIT_UNREPORTED_OUTPUT_LATENCY_MS : 0;
}
