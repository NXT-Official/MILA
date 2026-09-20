import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs";
// This subpath (not the package's default `main`, which pulls in the native
// @tensorflow/tfjs-node binding) is the canvas-free, native-binding-free
// build — see node_modules/@vladmandic/face-api/demo/node-wasm.js, the
// package's own reference example for this exact usage.
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import type { TNetInput } from "@vladmandic/face-api";

// Loaded from jsdelivr's npm CDN mirror (pinned to the installed package
// version) rather than the local node_modules/@vladmandic/face-api/model
// directory. Vercel's serverless bundling (nitro, noExternals: true) traces
// and bundles JS but doesn't copy non-JS model asset files into the deployed
// function — confirmed live in prod: ENOENT on the manifest json at
// /var/task/node_modules/... The wasm backend was dropped for the same
// reason plus a second, unrelated crash — tfjs-backend-wasm's locateFile
// logic references the CJS global __dirname, which doesn't exist in nitro's
// ESM output bundle (confirmed live: "ReferenceError: __dirname is not
// defined"). The cpu backend is pure JS, needs no external binary or model
// directory, and this workload (one face descriptor per attempt, rate
// limited to 30/day) doesn't need wasm's speed.
const MODEL_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${faceapi.version}/model`;

// Verified live against this exact model pairing (scripts/verify-face-match.ts):
// identical descriptors compare to ~0, but two different real people in
// harder (angled, similarly-lit) photos landed at 0.60 and 0.63 — right at
// the commonly-cited 0.6 "same person" cutoff. A stricter threshold trades a
// few unnecessary retries for fewer wrongly-accepted mismatches, which is the
// safer failure direction for this specific bug (someone else's face reaching
// the user). Tune from the distances logged below once real production data
// exists.
const FACE_MATCH_THRESHOLD = 0.5;
const DETECTION_MIN_CONFIDENCE = 0.5;

let modelsReady: Promise<void> | null = null;

/**
 * Cached across warm serverless invocations — only a cold start pays this.
 * Resets on failure rather than caching a rejected promise: a transient CDN
 * fetch error shouldn't permanently break face-match for the rest of this
 * container's warm lifetime.
 */
function ensureModelsLoaded(): Promise<void> {
  if (!modelsReady) {
    modelsReady = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    })().catch((err) => {
      modelsReady = null;
      throw err;
    });
  }
  return modelsReady;
}

/** Mirrors the Node demo's decode path (imageData -> int32 RGBA tensor -> RGB). */
function decodeJpegToTensor(bytes: Uint8Array): tf.Tensor3D {
  const { width, height, data } = jpeg.decode(bytes, { useTArray: true });
  return tf.tidy(() => {
    const raw = tf.tensor(Array.from(data), [height, width, 4], "int32");
    const channels = tf.split(raw, 4, 2);
    const rgb = tf.stack([channels[0], channels[1], channels[2]], 2);
    return tf.squeeze(rgb) as tf.Tensor3D;
  });
}

async function getFaceDescriptor(bytes: Uint8Array): Promise<Float32Array | null> {
  await ensureModelsLoaded();
  const tensor = decodeJpegToTensor(bytes);
  try {
    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: DETECTION_MIN_CONFIDENCE,
      maxResults: 1,
    });
    // face-api's bundled TFJS type declarations don't nominally match this
    // project's own @tensorflow/tfjs Tensor3D (same shape, different private
    // field provenance) — a known interop rough edge, not a real type risk.
    const faces = await faceapi
      .detectAllFaces(tensor as unknown as TNetInput, options)
      .withFaceLandmarks()
      .withFaceDescriptors();
    return faces[0]?.descriptor ?? null;
  } finally {
    tf.dispose(tensor);
  }
}

export type FaceMatchResult = {
  isMatch: boolean;
  distance: number | null;
  reason: string;
};

/**
 * Real, mathematical face-identity check — not an AI model's opinion. Verified
 * live (scripts/verify-face-match.ts) to produce consistent, discriminating
 * descriptors in this exact runtime (TFJS CPU backend, no native bindings,
 * no canvas).
 */
export async function verifyFaceMatch(
  originalBytes: Uint8Array,
  editedBytes: Uint8Array,
): Promise<FaceMatchResult> {
  const originalDescriptor = await getFaceDescriptor(originalBytes);
  if (!originalDescriptor) {
    // A bad reference photo shouldn't permanently block every future
    // generation for this user — the structural check still runs regardless.
    return {
      isMatch: true,
      distance: null,
      reason: "No face detected in the reference photo — face-match check skipped.",
    };
  }

  const editedDescriptor = await getFaceDescriptor(editedBytes);
  if (!editedDescriptor) {
    return {
      isMatch: false,
      distance: null,
      reason: "No face detected in the edited result.",
    };
  }

  const distance = faceapi.euclideanDistance(originalDescriptor, editedDescriptor);
  return {
    isMatch: distance <= FACE_MATCH_THRESHOLD,
    distance,
    reason:
      distance <= FACE_MATCH_THRESHOLD
        ? "Face matches the reference photo."
        : `Edited face does not match the reference photo (distance ${distance.toFixed(3)}).`,
  };
}
