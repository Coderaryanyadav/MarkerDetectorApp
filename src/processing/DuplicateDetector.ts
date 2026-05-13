/**
 * DuplicateDetector.ts — Perceptual hashing for duplicate frame rejection.
 *
 * WHY perceptual hashing over SSIM:
 *   - SSIM requires comparing full pixel grids → O(n²) per comparison.
 *   - Perceptual hashing: O(1) comparison (single XOR + popcount on 64-bit integers).
 *   - With 20 collected markers, we do up to 20 comparisons per new frame.
 *   - Hash computation is O(n) where n = image pixels, done once per capture.
 *
 * Algorithm (Average Hash — aHash):
 *   1. Downscale the 300×300 marker to 8×8 (64 pixels) using bilinear interpolation.
 *   2. Convert to grayscale (already grayscale in our pipeline).
 *   3. Compute mean pixel value across all 64 pixels.
 *   4. For each pixel: bit = (pixel >= mean) ? 1 : 0
 *   5. Pack 64 bits into a hex string (16 hex chars).
 *
 * WHY this works:
 *   The 8×8 downscale preserves the spatial distribution of light/dark regions
 *   while discarding high-frequency detail (noise, exact pixel values).
 *   Two photos of the same marker from the same position/angle produce nearly
 *   identical 8×8 spatial signatures. Different frames (different angles,
 *   distances, or different markers entirely) produce divergent signatures.
 *
 * Hamming distance:
 *   The number of bits that differ between two hashes.
 *   0 = identical, 32 = maximally different (for 64-bit hashes, expected random = 32).
 *   Threshold = 10: images must differ structurally (not just in noise).
 */

import { DUPLICATE_REJECTION } from '../constants';

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual hash computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the average perceptual hash of a grayscale image represented
 * as a flat Uint8Array of pixel values.
 *
 * @param pixels  Flat array of grayscale pixel values (0–255)
 * @param width   Image width in pixels
 * @param height  Image height in pixels
 * @returns       Hex string representing the 64-bit perceptual hash
 */
export function computePerceptualHash(
  pixels: Uint8Array | number[],
  width:  number,
  height: number
): string {
  const HASH_SIZE = DUPLICATE_REJECTION.HASH_SIZE;  // 8

  // Step 1: Downscale to 8×8 using bilinear interpolation
  const downscaled = downscale(pixels, width, height, HASH_SIZE, HASH_SIZE);

  // Step 2: Compute mean pixel value
  let sum = 0;
  for (let i = 0; i < downscaled.length; i++) {
    sum += downscaled[i];
  }
  const mean = sum / downscaled.length;

  // Step 3: Generate binary hash — each pixel compared to mean
  // Pack into 4-bit hex digits
  let hashHex = '';
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    let byte = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const pixelIdx = byteIdx * 8 + bitIdx;
      if (pixelIdx < downscaled.length && downscaled[pixelIdx] >= mean) {
        byte |= (1 << (7 - bitIdx));
      }
    }
    hashHex += byte.toString(16).padStart(2, '0');
  }

  return hashHex;
}

/**
 * Compute Hamming distance between two hex-encoded perceptual hashes.
 *
 * @returns Number of differing bits (0 = identical, max = 64)
 */
export function hashHammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    return 64;  // Maximum distance if hashes are different lengths
  }

  let distance = 0;
  for (let i = 0; i < hashA.length; i += 2) {
    const byteA = parseInt(hashA.substring(i, i + 2), 16);
    const byteB = parseInt(hashB.substring(i, i + 2), 16);
    // Count differing bits using Brian Kernighan's algorithm
    let xor = byteA ^ byteB;
    while (xor > 0) {
      xor &= (xor - 1);  // Clear lowest set bit
      distance++;
    }
  }

  return distance;
}

/**
 * Check if a new hash is a duplicate of any existing hash in the collection.
 *
 * @param newHash       Hash of the candidate image
 * @param existingHashes Array of hashes from already-collected markers
 * @returns             { isDuplicate, distance, closestHash }
 */
export function isDuplicateFrame(
  newHash:        string,
  existingHashes: string[]
): { isDuplicate: boolean; minDistance: number } {
  const threshold = DUPLICATE_REJECTION.HASH_SIMILARITY_THRESHOLD;
  let minDistance = 64;

  for (const existing of existingHashes) {
    const dist = hashHammingDistance(newHash, existing);
    if (dist < minDistance) {
      minDistance = dist;
    }
    // Early exit: if we find an exact or near-exact match, no need to check more
    if (dist <= threshold) {
      return { isDuplicate: true, minDistance: dist };
    }
  }

  return { isDuplicate: false, minDistance };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bilinear downscale (pure JS — no OpenCV dependency for the JS layer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downscale a grayscale image using bilinear interpolation.
 * This is a pure-JS implementation for use in the React Native JS thread.
 *
 * For the native C++ layer, cv::resize with INTER_AREA is used instead
 * (significantly faster for large images).
 *
 * @param pixels  Flat grayscale pixel array
 * @param srcW    Source width
 * @param srcH    Source height
 * @param dstW    Destination width
 * @param dstH    Destination height
 * @returns       Downscaled pixel array (length = dstW × dstH)
 */
function downscale(
  pixels: Uint8Array | number[],
  srcW:   number,
  srcH:   number,
  dstW:   number,
  dstH:   number
): number[] {
  const result: number[] = new Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dstY = 0; dstY < dstH; dstY++) {
    for (let dstX = 0; dstX < dstW; dstX++) {
      // Map destination pixel to source coordinates
      const srcX = dstX * xRatio;
      const srcY = dstY * yRatio;

      // Integer and fractional parts
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const fx = srcX - x0;
      const fy = srcY - y0;

      // Bilinear interpolation
      const topLeft     = pixels[y0 * srcW + x0] ?? 0;
      const topRight    = pixels[y0 * srcW + x1] ?? 0;
      const bottomLeft  = pixels[y1 * srcW + x0] ?? 0;
      const bottomRight = pixels[y1 * srcW + x1] ?? 0;

      const top    = topLeft    + fx * (topRight    - topLeft);
      const bottom = bottomLeft + fx * (bottomRight - bottomLeft);
      const value  = top        + fy * (bottom      - top);

      result[dstY * dstW + dstX] = Math.round(value);
    }
  }

  return result;
}
