// @vitest-environment happy-dom
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { createReceipt, type ReceiptDeps, type ReceiptError } from "./Receipt";

// happy-dom has no canvas 2D implementation, so the injected createCanvas
// points at a real Node canvas. This is what the dependency injection is for.
const require = createRequire(import.meta.url);
GlobalFonts.registerFromPath(
  require.resolve("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"),
  "JetBrains Mono",
);

function stubDeps(overrides: Partial<ReceiptDeps> = {}): ReceiptDeps {
  const frames: ((t: number) => void)[] = [];
  return {
    createRenderer: () => ({
      domElement: document.createElement("canvas"),
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }),
    createCanvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: vi.fn(),
    ...overrides,
  };
}

describe("createReceipt", () => {
  it("mounts a canvas into the container", () => {
    const el = document.createElement("div");
    const r = createReceipt(el, { text: "HELLO" }, stubDeps());
    expect(el.querySelector("canvas")).not.toBeNull();
    r.dispose();
  });

  it("calls onReady once mounted", () => {
    const onReady = vi.fn();
    const r = createReceipt(document.createElement("div"), { text: "A", onReady }, stubDeps());
    expect(onReady).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it("falls back to a flat image when there is no WebGL", () => {
    const errors: ReceiptError[] = [];
    const el = document.createElement("div");
    const r = createReceipt(
      el,
      { text: "A", onError: (e) => errors.push(e) },
      stubDeps({
        createRenderer: () => {
          throw new Error("no webgl2");
        },
      }),
    );
    expect(errors.map((e) => e.code)).toContain("no-webgl");
    expect(el.querySelector("img")).not.toBeNull();
    r.dispose();
  });

  it("reports clamping for absurd text", () => {
    const errors: ReceiptError[] = [];
    const r = createReceipt(
      document.createElement("div"),
      { text: "line\n".repeat(5000), onError: (e) => errors.push(e) },
      stubDeps(),
    );
    expect(errors.map((e) => e.code)).toContain("clamped");
    r.dispose();
  });

  it("keeps the same canvas when the text changes", () => {
    const el = document.createElement("div");
    const r = createReceipt(el, { text: "A" }, stubDeps());
    const before = el.querySelector("canvas");
    r.setText("B\n".repeat(60));
    expect(el.querySelector("canvas")).toBe(before);
    r.dispose();
  });

  it("removes everything it added on dispose", () => {
    const el = document.createElement("div");
    const r = createReceipt(el, { text: "A" }, stubDeps());
    r.dispose();
    expect(el.children.length).toBe(0);
  });

  it("is idempotent on double dispose", () => {
    const r = createReceipt(document.createElement("div"), { text: "A" }, stubDeps());
    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });
});
