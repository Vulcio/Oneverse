import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const purify = createDOMPurify(new JSDOM("").window as unknown as Parameters<typeof createDOMPurify>[0]);
/** A reference that stays inside the file: a fragment (#gradient), or an embedded picture. */
const internal = (value: string) => /^\s*(#|data:image\/(png|jpeg|gif|webp);)/i.test(value);
// Outside references in an attribute's value (href, xlink:href) go; inside ones stay.
purify.addHook("uponSanitizeAttribute", (_node, data) => {
  if ((data.attrName === "href" || data.attrName === "xlink:href") && !internal(data.attrValue)) data.keepAttr = false;
});

/** CSS that would fetch something from elsewhere: @import, and url(…) to anything but a fragment or an embedded picture. */
const outsideCss = (css: string) => css.replace(/@import[^;]*;?/gi, "").replace(/url\(\s*(['"]?)(?!#|data:image\/)[^)]*\)/gi, "none");

/**
 * An uploaded SVG made safe to show (issue #295): its shapes, gradients,
 * filters, CSS and SMIL animation kept; script, event handlers,
 * foreignObject (HTML inside) and outside references removed. Null when it
 * isn't an SVG. It's still sent sandboxed (send-file.ts).
 */
export function sanitizeSvg(input: Buffer): Buffer | null {
  const text = input.toString("utf8");
  if (!/<svg[\s>]/i.test(text)) return null;
  const clean = purify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // SMIL animation, which the SVG profile leaves out, and <use> (its href kept only when it points inside).
    ADD_TAGS: ["animate", "animateTransform", "animateMotion", "set", "mpath", "style", "use"],
    ADD_ATTR: ["attributeName", "attributeType", "begin", "dur", "end", "repeatCount", "repeatDur", "values", "keyTimes", "keySplines", "calcMode", "from", "to", "by", "additive", "accumulate", "restart", "rotate", "path", "keyPoints", "fill"],
    FORBID_TAGS: ["foreignObject", "script", "iframe", "image"],
    FORBID_ATTR: ["onbegin", "onend", "onrepeat", "onload", "onclick"],
  });
  const svg = outsideCss(clean).trim();
  if (!/^<svg[\s>]/i.test(svg)) return null;
  // Shown as a picture, it needs its namespace.
  const named = /^<svg[^>]*\sxmlns=/i.test(svg) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return Buffer.from(named, "utf8");
}

/**
 * An uploaded Lottie animation checked (issue #295): JSON with a version,
 * a frame rate, in and out points and its layers; the pictures it would load
 * from elsewhere removed (embedded ones kept). Null when it isn't one.
 */
export function cleanLottie(input: Buffer): Buffer | null {
  let animation: unknown;
  try {
    animation = JSON.parse(input.toString("utf8"));
  } catch {
    return null;
  }
  if (!animation || typeof animation !== "object" || Array.isArray(animation)) return null;
  const lottie = animation as { v?: unknown; fr?: unknown; ip?: unknown; op?: unknown; layers?: unknown; assets?: unknown };
  if (typeof lottie.v !== "string" || typeof lottie.fr !== "number" || typeof lottie.ip !== "number" || typeof lottie.op !== "number" || !Array.isArray(lottie.layers)) return null;
  if (Array.isArray(lottie.assets)) {
    lottie.assets = lottie.assets.filter((asset: unknown) => {
      if (!asset || typeof asset !== "object") return false;
      const path = (asset as { p?: unknown }).p;
      // A precomposition (layers, no picture), or a picture embedded in the file.
      return path === undefined || (typeof path === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(path));
    });
  }
  return Buffer.from(JSON.stringify(lottie), "utf8");
}
