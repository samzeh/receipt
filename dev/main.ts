import "@fontsource/jetbrains-mono/400.css";
import GUI from "lil-gui";
import { createReceipt, type ReceiptHandle } from "../src/core/Receipt";
import { DEFAULT_PARAMS } from "../src/sim/Cloth";

const PLACEHOLDER = [
  "      RECEIPT PRINTER",
  "     *** BOOK REVIEW ***",
  "DATE 11/09/26    #1109610",
  "-------------------------",
  "THE ALLOY OF LAW",
  "by Brandon Sanderson",
  "-------------------------",
  "PAGES                 336",
  "WORDS               122.0K",
  "HOURS                 7-8",
  "FINISHED         11/03/26",
  "-------------------------",
  "NOTES:",
  "Slow start (for me), but",
  "picked up around 30-40%.",
  "",
  "Kind of strange to go from",
  "reading dense multi-POV",
  "tomes to a short novel",
  "that reads like Sherlock",
  "Holmes and the Hardy Boys.",
  "",
  "Dinged it because all the",
  "twists were predictable.",
  "-------------------------",
  "TOTAL           ***1/2",
  "CHANGE          MY LIFE",
  "",
  "  THANK YOU FOR READING",
].join("\n");

const stage = document.querySelector<HTMLElement>("#stage")!;

// On-page diagnostics, so problems are legible without devtools.
const hud = document.createElement("pre");
hud.id = "hud";
document.body.appendChild(hud);
const notes: string[] = [];
let frames = 0;
const tick = (): void => {
  frames += 1;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

function report(): void {
  const canvas = stage.querySelector("canvas");
  const rect = canvas?.getBoundingClientRect();
  hud.textContent = [
    `frames      ${frames}`,
    `canvas      ${canvas ? `${canvas.width}x${canvas.height} attr` : "MISSING"}`,
    `canvas css  ${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "-"}`,
    `viewport    ${innerWidth}x${innerHeight}  dpr ${devicePixelRatio}`,
    `img         ${stage.querySelector("img") ? "FALLBACK SHOWN" : "none"}`,
    ...notes.slice(-4),
  ].join("\n");
}
setInterval(report, 500);

const tuning = {
  bendAlong: DEFAULT_PARAMS.bendComplianceAlongPerMetre,
  bendAcross: DEFAULT_PARAMS.bendComplianceAcrossPerMetre,
  drag: DEFAULT_PARAMS.dragCoefficient,
  damping: DEFAULT_PARAMS.damping,
  gravity: 0,
  grabRadiusMm: DEFAULT_PARAMS.grabRadius * 1000,
  grabCompliance: DEFAULT_PARAMS.grabCompliance,
  curlMm: DEFAULT_PARAMS.restCurlRadius * 1000,
  fontMm: 3.2,
};

let handle: ReceiptHandle | null = null;

function mount(): void {
  handle?.dispose();
  handle = createReceipt(stage, {
    text: PLACEHOLDER,
    paper: {
      bendComplianceAlong: tuning.bendAlong,
      bendComplianceAcross: tuning.bendAcross,
      dragCoefficient: tuning.drag,
      damping: tuning.damping,
      gravity: tuning.gravity,
      grabRadiusMm: tuning.grabRadiusMm,
      grabCompliance: tuning.grabCompliance,
      restCurlRadiusMm: tuning.curlMm,
    },
    onError: (e) => {
      notes.push(`error       ${e.code}: ${e.message}`);
      console.warn("[receipt]", e.code, e.message);
    },
    onReady: () => {
      notes.push("ready       yes");
      console.info("[receipt] ready");
    },
  });
}

// The font must be resident before the first draw, or the canvas falls back to
// a system monospace and the layout arithmetic no longer matches the glyphs.
await document.fonts.load('10px "JetBrains Mono"');
mount();

const gui = new GUI({ title: "paper" });
gui.add(tuning, "bendAlong", 0.5, 120, 0.5).onFinishChange(mount);
gui.add(tuning, "bendAcross", 0.5, 120, 0.5).onFinishChange(mount);
gui.add(tuning, "drag", 0, 4, 0.05).onFinishChange(mount);
gui.add(tuning, "damping", 0, 20, 0.25).onFinishChange(mount);
gui.add(tuning, "gravity", 0, 9.81, 0.1).onFinishChange(mount);
gui.add(tuning, "grabRadiusMm", 0, 40, 1).onFinishChange(mount);
gui.add(tuning, "grabCompliance", 0, 0.15, 0.005).onFinishChange(mount);
gui.add({ recenter: () => handle?.recenter() }, "recenter");
gui.add({ reset: mount }, "reset");
gui.add(tuning, "curlMm", 40, 2000, 10).onFinishChange(mount);
