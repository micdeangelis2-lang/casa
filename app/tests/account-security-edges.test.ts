import { describe, expect, it } from "vitest";
import { describeUserAgent, maskIpAddress } from "@/shared/account-security";

describe("sicurezza dell'account: user agent (casi limite)", () => {
  const ua = {
    opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
    samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    chromeOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
    firefoxIos: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15",
    edgeAndroid: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
    safariWithoutVersion: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
  };

  it("riconosce Opera, Samsung Internet e le varianti iOS, rispettando l'ordine (Edge/Opera/Samsung prima di Chrome)", () => {
    expect(describeUserAgent(ua.opera)).toEqual({ browser: "Opera", os: "Windows" });
    expect(describeUserAgent(ua.samsung)).toEqual({ browser: "Samsung Internet", os: "Android" });
    expect(describeUserAgent(ua.chromeOs)).toEqual({ browser: "Chrome", os: "ChromeOS" });
    expect(describeUserAgent(ua.chromeIos)).toEqual({ browser: "Chrome", os: "iOS" });
    expect(describeUserAgent(ua.firefoxIos)).toEqual({ browser: "Firefox", os: "iOS" });
    expect(describeUserAgent(ua.edgeAndroid)).toEqual({ browser: "Edge", os: "Android" });
  });

  it("«Safari» senza «Version/» non e' Safari (e' un'etichetta di altri client); stringhe vuote o di soli spazi non descrivono nulla", () => {
    expect(describeUserAgent(ua.safariWithoutVersion)).toEqual({ browser: null, os: "macOS" });
    expect(describeUserAgent("")).toEqual({ browser: null, os: null });
    expect(describeUserAgent(undefined)).toEqual({ browser: null, os: null });
    expect(describeUserAgent("   ")).toEqual({ browser: null, os: null });
  });

  it("uno user agent ostile (enorme o con markup) non lancia e restituisce solo etichette note", () => {
    const hostile = `<script>alert(1)</script>${"A".repeat(100_000)} Chrome/1 Windows`;
    const r = describeUserAgent(hostile);
    expect(["Chrome", null]).toContain(r.browser);
    expect(JSON.stringify(r)).not.toContain("script");
  });
});

describe("sicurezza dell'account: indirizzi IP mascherati (casi limite)", () => {
  it("IPv6 mal formati non si mostrano affatto", () => {
    for (const bad of ["1::2::3", "gggg::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8", "2001:db8:1:2:3:4:5:6::", "999.1.1.1.1", "1.2.3", "javascript:alert(1)"]) {
      expect(maskIpAddress(bad), bad).toBeNull();
    }
  });

  it("IPv6 completo, abbreviato in testa, in coda e solo «::»; maiuscole e spazi ai bordi", () => {
    expect(maskIpAddress("1:2:3:4:5:6:7:8")).toBe("1:2:3:4:…");
    expect(maskIpAddress("::")).toBe("0:0:0:0:…");
    expect(maskIpAddress("fe80::")).toBe("fe80:0:0:0:…");
    expect(maskIpAddress("  2001:DB8::1  ")).toBe("2001:DB8:0:0:…");
    expect(maskIpAddress(" 10.0.0.9 ")).toBe("10.0.0.x");
  });

  it("l'ultima parte non compare mai nel risultato", () => {
    for (const ip of ["203.0.113.199", "::ffff:203.0.113.199", "2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff"]) {
      const masked = maskIpAddress(ip)!;
      expect(masked).not.toContain("199");
      expect(masked).not.toContain("ffff:ffff");
      expect(masked.includes("eeee") || masked.includes("dddd")).toBe(false);
    }
  });
});
