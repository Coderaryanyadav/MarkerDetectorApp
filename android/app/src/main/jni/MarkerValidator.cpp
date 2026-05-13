/**
 * MarkerValidator.cpp — Steps 7–8: Validation and false positive rejection.
 *
 * Step 7: Validate internal marker structure (grid blackness + code extraction)
 * Step 8: Reject false positives (border check, code match threshold, duplicate
 * check)
 */
#include "include/DetectorTypes.h"
#include "include/GeometryUtils.h"
#include "include/MarkerStructureValidator.h"
#include "include/PerspectiveProcessor.h"

#include <android/log.h>
#include <cmath>
#include <opencv2/imgproc.hpp>

#define LOG_TAG "MarkerValidator"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace MarkerValidator {

/**
 * Run the full validation pipeline on a single candidate.
 *
 * Returns true if the candidate passes all checks, with outResult populated.
 * Returns false immediately on any failed check (early rejection = fast).
 *
 * REJECTION REASONS (in order of cheapness):
 *   A. No reference codes loaded (detector not initialized)
 *   B. Border not sufficiently black (borderMean > state.borderBlackThresh)
 *   C. Code match too poor (hammingDist > state.maxBitErrors)
 *   D. Confidence below MIN_CONFIDENCE (degenerate geometry)
 *
 * WHY this order matters:
 *   A and B are computed on the warped image before code extraction.
 *   They cheaply reject most non-marker shapes before doing the
 *   25-cell code extraction and matching.
 *
 * @param gray       Grayscale processed frame (640×480)
 * @param candidate  Candidate to validate
 * @param state      Detector state (references + thresholds)
 * @param outResult  Populated on success
 * @return           true if valid marker detected
 */
bool validate(const cv::Mat &gray, const MarkerCandidate &candidate,
              const DetectorState &state, DetectionResult &outResult) {
  // ── Rejection A: No references loaded ────────────────────────────────
  if (state.references.empty()) {
    LOGW("validate: No reference markers loaded");
    return false;
  }

  // ── Step 9: Perspective warp → 300×300 normalized view ───────────────
  cv::Mat warped = PerspectiveProcessor::warpToSquare(gray, candidate.corners);
  if (warped.empty())
    return false;

  // ── Step 11: Border blackness check (cheap — do before code extraction) ─
  // FALSE POSITIVE REJECTION EXPLANATION:
  //   A plain white wall corner, a book cover corner, or a TV bezel can
  //   pass the contour + polygon + aspect-ratio filters. The mandatory black
  //   border distinguishes the marker (which MUST have a black border)
  //   from these false positives. We reject anything where the border
  //   mean pixel value exceeds borderBlackThresh (default: 80/255).
  float borderMean = PerspectiveProcessor::checkBorderBlackness(
      warped, state.borderBlackThresh);
  if (borderMean > state.borderBlackThresh) {
    LOGD("validate: Rejected — border too bright (mean=%.1f)", borderMean);
    return false;
  }

  // ── Step 12: Resize (already at 300×300 from warp, no-op needed) ─────
  // The warpToSquare function outputs exactly WARP_SIZE × WARP_SIZE.

  // ── Step 7: Extract 5×5 binary code ──────────────────────────────────
  // Extracted once here and reused by both structural validation and
  // orientation matching below — avoids duplicate 25-cell ROI computation.
  uint32_t code = PerspectiveProcessor::extractCode(warped);
  LOGD("validate: Extracted code = 0x%08X", code);

  // ── Step 8: Structural validation (multi-stage) ──────────────────────
  //   Runs all 5 structural checks: corner angles, border thickness,
  //   white-space ratio, internal hierarchy, asymmetry.
  //   This is the main false-positive prevention layer — rejects
  //   books, windows, monitors, picture frames, tables, etc.
  {
    std::string rejectReason;
    bool structureOk = MarkerStructureValidator::validateStructure(
        warped, candidate.corners, code, rejectReason);
    if (!structureOk) {
      LOGD("validate: Rejected — structural: %s", rejectReason.c_str());
      return false;
    }
  }

  // ── Step 10: Orientation matching ────────────────────────────────────
  int matchedMarkerId;
  int rotationApplied;
  int hammingDist;
  uint32_t canonicalCode = PerspectiveProcessor::matchAndOrient(
      code, state.references, matchedMarkerId, rotationApplied, hammingDist);

  // ── Rejection C: Code match too poor ─────────────────────────────────
  // FALSE POSITIVE PREVENTION:
  //   Even if an object passes all geometric tests AND has a black border,
  //   its internal pattern must match a known marker within state.maxBitErrors
  //   bit errors. A random pattern will have ~12–13 bits wrong (50% by chance).
  //   Our threshold of 5 bits wrong (80% match) is far below the random
  //   false-positive rate, providing strong selectivity.
  if (matchedMarkerId < 0 || hammingDist > state.maxBitErrors) {
    LOGD("validate: Rejected — code mismatch (hamming=%d, maxAllowed=%d)",
         hammingDist, state.maxBitErrors);
    return false;
  }

  // ── Step 10: Apply orientation correction to corners ──────────────────
  //   If the marker was placed rotated, we received it in rotated form.
  //   rotationApplied tells us how many 90° CW rotations to undo.
  std::vector<cv::Point2f> correctedCorners =
      PerspectiveProcessor::rotateCorners(candidate.corners, rotationApplied);

  // ── Compute confidence score ──────────────────────────────────────────
  float geoScore = PerspectiveProcessor::geometryScore(candidate);
  float confidence = PerspectiveProcessor::computeConfidence(
      hammingDist, geoScore, borderMean);

  // ── Rejection D: Confidence too low ──────────────────────────────────
  constexpr float MIN_CONFIDENCE = 0.4f;
  if (confidence < MIN_CONFIDENCE) {
    LOGD("validate: Rejected — confidence too low (%.2f)", confidence);
    return false;
  }

  // ── Populate result ───────────────────────────────────────────────────
  outResult.detected = true;
  outResult.markerId = matchedMarkerId;
  outResult.confidence = confidence;
  outResult.corners = correctedCorners;
  outResult.normalizedView = warped;
  outResult.orientationDeg = rotationApplied * 90;

  LOGD("validate: SUCCESS — marker %d, confidence=%.2f, hamming=%d, "
       "rotation=%d°",
       matchedMarkerId, confidence, hammingDist, outResult.orientationDeg);

  return true;
}

/**
 * Process a warped reference image to extract its 25-bit canonical code.
 * Called once per reference marker at init time.
 *
 * Algorithm:
 *   1. Convert reference bitmap to grayscale (already done in JNI layer)
 *   2. Resize to 300×300
 *   3. Apply adaptive threshold to binarize
 *   4. Extract the 5×5 code
 *   5. Store all 4 rotations
 *
 * WHY compute reference codes dynamically:
 *   Hard-coding codes would require knowing the exact marker designs in
 * advance. Computing from the reference image is self-calibrating — works with
 * any square binary marker that follows the border + inner grid convention.
 *
 * @param refGray    Grayscale reference marker image (any size)
 * @param markerId   ID to assign (1 or 2)
 * @return           Populated MarkerReference with all 4 orientation codes
 */
MarkerReference buildReference(const cv::Mat &refGray, int markerId) {
  MarkerReference ref;
  ref.id = markerId;

  // Resize to canonical size for consistent code extraction
  cv::Mat resized;
  cv::resize(refGray, resized,
             cv::Size(PerspectiveProcessor::WARP_SIZE,
                      PerspectiveProcessor::WARP_SIZE),
             0, 0, cv::INTER_AREA);

  // Apply mild blur + threshold to clean up any JPEG compression artifacts
  cv::Mat blurred;
  cv::GaussianBlur(resized, blurred, cv::Size(3, 3), 0);

  // For reference images, the marker fills the frame, so adaptive threshold
  // with a smaller block size works better than the per-frame parameters.
  cv::Mat grayFromBinary;
  cv::adaptiveThreshold(blurred, grayFromBinary, 255, cv::ADAPTIVE_THRESH_MEAN_C,
                        cv::THRESH_BINARY, 31, 5);

  // Extract canonical code (rotation 0)
  ref.codes[0] = PerspectiveProcessor::extractCode(grayFromBinary);

  // Generate all 4 rotations
  ref.codes[1] = GeometryUtils::rotate5x5_90cw(ref.codes[0]);
  ref.codes[2] = GeometryUtils::rotate5x5_90cw(ref.codes[1]);
  ref.codes[3] = GeometryUtils::rotate5x5_90cw(ref.codes[2]);

  // Store resized grayscale for debug display
  ref.referenceImage = resized.clone();

  LOGD("Reference marker %d: codes = [0x%08X, 0x%08X, 0x%08X, 0x%08X]",
       markerId, ref.codes[0], ref.codes[1], ref.codes[2], ref.codes[3]);

  return ref;
}

} // namespace MarkerValidator
