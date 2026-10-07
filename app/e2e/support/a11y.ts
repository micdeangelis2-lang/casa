import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Violazioni WCAG 2.x A/AA trovate da axe, con gli elementi coinvolti (vuoto = nessuna). */
export async function a11yViolations(page: Page): Promise<string[]> {
  // I componenti hanno transizioni CSS (es. un pulsante che passa da disabilitato ad abilitato):
  // misurare il contrasto a meta' transizione darebbe falsi positivi. Si attende la fine di tutte le animazioni.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations.map(
    (v) => `${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`,
  );
}
