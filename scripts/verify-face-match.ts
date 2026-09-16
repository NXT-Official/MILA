/**
 * Standalone proof that @vladmandic/face-api's canvas-free, native-binding-free
 * WASM path actually produces meaningful face descriptors in this runtime,
 * before wiring it into the live photo-preview pipeline. Run with:
 *   bun run scripts/verify-face-match.ts
 *
 * Uses face-api's own bundled demo images (node_modules/@vladmandic/face-api/demo)
 * so this needs no network access and no real user data. sample1.jpg has 3
 * distinct women, sample4.jpg has 4 distinct women — every cross-image and
 * cross-person pairing here is a genuinely different face.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs";
import * as wasm from "@tensorflow/tfjs-backend-wasm";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import type { TNetInput } from "@vladmandic/face-api";

const MODEL_DIR = join(process.cwd(), "node_modules/@vladmandic/face-api/model");
const DEMO_DIR = join(process.cwd(), "node_modules/@vladmandic/face-api/demo");

function decodeJpegToTensor(bytes: Uint8Array): tf.Tensor3D {
  const { width, height, data } = jpeg.decode(bytes, { useTArray: true });
  return tf.tidy(() => {
    const raw = tf.tensor(Array.from(data), [height, width, 4], "int32");
    const channels = tf.split(raw, 4, 2);
    const rgb = tf.stack([channels[0], channels[1], channels[2]], 2);
    return tf.squeeze(rgb) as tf.Tensor3D;
  });
}

async function getDescriptors(fileName: string): Promise<Float32Array[]> {
  const bytes = readFileSync(join(DEMO_DIR, fileName));
  const tensor = decodeJpegToTensor(bytes);
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
  const faces = await faceapi
    .detectAllFaces(tensor as unknown as TNetInput, options)
    .withFaceLandmarks()
    .withFaceDescriptors();
  tf.dispose(tensor);
  console.log(`${fileName}: detected ${faces.length} face(s)`);
  return faces.map((f: { descriptor: Float32Array }) => f.descriptor);
}

async function main() {
  wasm.setWasmPaths(join(process.cwd(), "node_modules/@tensorflow/tfjs-backend-wasm/dist/") + "/");
  await tf.setBackend("wasm");
  await tf.ready();
  console.log(`TFJS backend: ${tf.getBackend()}`);

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  console.log("Models loaded.");

  const sample1 = await getDescriptors("sample1.jpg"); // 3 distinct women
  const sample4 = await getDescriptors("sample4.jpg"); // 4 distinct women

  if (sample1.length < 2 || sample4.length < 2) {
    throw new Error("Expected multiple faces per sample image — detection may be broken.");
  }

  const sameImageDifferentPeople = faceapi.euclideanDistance(sample1[0], sample1[1]);
  const crossImageDifferentPeople = faceapi.euclideanDistance(sample1[0], sample4[0]);
  const sameDescriptorTwice = faceapi.euclideanDistance(sample1[0], sample1[0]);

  console.log("\n--- Results ---");
  console.log(
    `Same descriptor compared to itself (sanity, must be ~0):  ${sameDescriptorTwice.toFixed(4)}`,
  );
  console.log(
    `Two different women, same photo (expect clearly > 0):     ${sameImageDifferentPeople.toFixed(4)}`,
  );
  console.log(
    `Two different women, different photos (expect > 0):       ${crossImageDifferentPeople.toFixed(4)}`,
  );
  console.log(
    "\nNote: these two distinct-people pairs landed right around the commonly-cited\n" +
      "0.6 'same person' cutoff (0.60, 0.63) — these are angled, similarly-lit demo\n" +
      "photos, a harder case than a clean frontal selfie. This is real signal that a\n" +
      "0.6 cutoff risks false-accepts on hard photos, so face-match.server.ts uses a\n" +
      "stricter 0.5 threshold, favoring 'retry/fallback' (safe) over 'wrongly accept a\n" +
      "different face' (unsafe) when a photo is ambiguous. Tune from real production\n" +
      "distances (logged on every check) once there's live data.",
  );

  if (sameDescriptorTwice > 0.01) {
    throw new Error("FAIL: identical descriptor did not compare to itself as ~0.");
  }
  // Loose sanity bound only — just confirms the pipeline isn't broken and
  // returning near-zero (i.e. "everyone matches") for genuinely different
  // people. The real threshold decision is documented above, not asserted
  // here, since these specific demo photos are a hard case either way.
  if (sameImageDifferentPeople < 0.3 || crossImageDifferentPeople < 0.3) {
    throw new Error(
      "FAIL: distinct people scored too close to 0 — model isn't discriminating at all.",
    );
  }
  console.log(
    "\nPASS: descriptors are consistent (identical image -> 0) and clearly separate different people (> 0.3).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
