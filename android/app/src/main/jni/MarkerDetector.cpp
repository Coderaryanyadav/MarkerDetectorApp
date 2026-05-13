/**
 * MarkerDetector.cpp — JNI entry point orchestrating the full 12-step pipeline.
 *
 * Full pipeline:
 *   [JNI] → Step 1: YUV → Gray
 *         → Step 2: Gaussian Blur          (ImageProcessor)
 *         → Step 3: Adaptive Threshold      (ImageProcessor)
 *         → Step 3b: Morphological Close    (ImageProcessor)
 *         → Step 4: Find Contours           (ContourAnalyzer)
 *         → Step 5: approxPolyDP → Quads   (ContourAnalyzer)
 *         → Step 6: Filter Candidates       (ContourAnalyzer + NMS)
 *         → For each candidate:
 *             → Step 9:  Perspective Warp   (PerspectiveProcessor)
 *             → Step 11: Border Check        (PerspectiveProcessor)  [Step 8]
 *             → Step 12: Extract Code        (PerspectiveProcessor)  [Step 7]
 *             → Step 10: Orient + Match      (PerspectiveProcessor)
 *             → Step 7/8: Validate           (MarkerValidator)
 *         → Best result → return to JS
 *
 * Note on step numbering vs implementation order:
 *   Steps 9–12 (perspective + code) happen INSIDE the per-candidate loop
 *   as part of the validation. The "Validate internal structure" (Step 7)
 *   and "Reject false positives" (Step 8) refer to checks done AFTER the warp.
 *   This is the correct implementation order: warp first, then analyze content.
 */
#include <android/bitmap.h>
#include <android/log.h>
#include <jni.h>
#include <memory>
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <string>
#include <vector>

#include "include/ContourAnalyzer.h"
#include "include/DetectorTypes.h"
#include "include/ImageProcessor.h"
#include "include/PerspectiveProcessor.h"

// ── Forward declaration (MarkerValidator.cpp)
// ─────────────────────────────────
namespace MarkerValidator {
bool validate(const cv::Mat &, const MarkerCandidate &, const DetectorState &,
              DetectionResult &);
MarkerReference buildReference(const cv::Mat &, int);
} // namespace MarkerValidator

#define LOG_TAG "MarkerDetector"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

// ── Processing dimensions (must match the JS-side useCameraSetup) ────────────
static constexpr int PROCESS_W = 640;
static constexpr int PROCESS_H = 480;

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Android Bitmap → cv::Mat (grayscale)
// ─────────────────────────────────────────────────────────────────────────────

static cv::Mat bitmapToGrayMat(JNIEnv *env, jobject bitmap) {
  AndroidBitmapInfo info;
  if (AndroidBitmap_getInfo(env, bitmap, &info) !=
      ANDROID_BITMAP_RESULT_SUCCESS) {
    LOGE("bitmapToGrayMat: failed to get bitmap info");
    return {};
  }

  void *pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) !=
      ANDROID_BITMAP_RESULT_SUCCESS) {
    LOGE("bitmapToGrayMat: failed to lock pixels");
    return {};
  }

  cv::Mat rgba(static_cast<int>(info.height), static_cast<int>(info.width),
               CV_8UC4, pixels);

  cv::Mat gray;
  cv::cvtColor(rgba, gray, cv::COLOR_RGBA2GRAY);

  AndroidBitmap_unlockPixels(env, bitmap);

  // Return a clone since we're about to unlock the bitmap
  return gray.clone();
}

// ─────────────────────────────────────────────────────────────────────────────
// JNI: Initialize detector
// ─────────────────────────────────────────────────────────────────────────────

extern "C" JNIEXPORT jlong JNICALL
Java_com_markerdetectorapp_opencv_MarkerDetectorModule_nativeInit(
    JNIEnv *env, jobject /* this */, jobject marker1Bitmap,
    jobject marker2Bitmap) {
  LOGI("=== MarkerDetector Native Init ===");

  // Allocate state on heap — returned as opaque handle to Kotlin
  auto *state = new DetectorState();

  // Convert reference bitmaps to grayscale
  cv::Mat ref1Gray = bitmapToGrayMat(env, marker1Bitmap);
  cv::Mat ref2Gray = bitmapToGrayMat(env, marker2Bitmap);

  if (ref1Gray.empty() || ref2Gray.empty()) {
    LOGE("nativeInit: Failed to load reference bitmaps");
    delete state;
    return 0;
  }

  LOGI("Reference 1: %dx%d, Reference 2: %dx%d", ref1Gray.cols, ref1Gray.rows,
       ref2Gray.cols, ref2Gray.rows);

  // Build reference codes from marker bitmaps
  state->references.push_back(MarkerValidator::buildReference(ref1Gray, 1));
  state->references.push_back(MarkerValidator::buildReference(ref2Gray, 2));

  LOGI("nativeInit: Loaded %zu reference markers", state->references.size());
  LOGI("=== Init Complete ===");

  return reinterpret_cast<jlong>(state);
}

// ─────────────────────────────────────────────────────────────────────────────
// JNI: Process frame — full 12-step pipeline
// ─────────────────────────────────────────────────────────────────────────────

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_markerdetectorapp_opencv_MarkerDetectorModule_nativeDetect(
    JNIEnv *env, jobject /* this */, jlong nativeHandle, jbyteArray yuvData,
    jint width, jint height) {
  if (nativeHandle == 0) {
    LOGE("nativeDetect: Invalid handle");
    return env->NewFloatArray(0);
  }

  auto *state = reinterpret_cast<DetectorState *>(nativeHandle);

  // ── Get YUV bytes ─────────────────────────────────────────────────────
  jsize yuvLen = env->GetArrayLength(yuvData);
  jbyte *yuvBytes = env->GetByteArrayElements(yuvData, nullptr);
  if (!yuvBytes)
    return env->NewFloatArray(0);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: YUV → Grayscale
  // ══════════════════════════════════════════════════════════════════════
  cv::Mat fullGray = ImageProcessor::yuvToGray(
      reinterpret_cast<const uint8_t *>(yuvBytes), static_cast<int>(width),
      static_cast<int>(height));
  env->ReleaseByteArrayElements(yuvData, yuvBytes, JNI_ABORT);
  // JNI_ABORT: don't copy back — we only read from the array

  if (fullGray.empty())
    return env->NewFloatArray(0);

  // ── Downsample to processing resolution ───────────────────────────────
  cv::Mat gray = ImageProcessor::downsample(fullGray, PROCESS_W, PROCESS_H);

  // Scale factor for reporting corners back in ORIGINAL frame coordinates
  float scaleX = static_cast<float>(width) / static_cast<float>(PROCESS_W);
  float scaleY = static_cast<float>(height) / static_cast<float>(PROCESS_H);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: Gaussian Blur
  // ══════════════════════════════════════════════════════════════════════
  cv::Mat blurred = ImageProcessor::applyGaussianBlur(gray);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: Adaptive Threshold + Morphological Close
  // ══════════════════════════════════════════════════════════════════════
  cv::Mat binary = ImageProcessor::adaptiveThreshold(blurred);
  binary = ImageProcessor::morphClose(binary);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 4: Find External Contours
  // ══════════════════════════════════════════════════════════════════════
  auto allContours = ContourAnalyzer::findContours(binary);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 5: approxPolyDP → find quadrilateral shapes
  // ══════════════════════════════════════════════════════════════════════
  float imageArea = static_cast<float>(PROCESS_W * PROCESS_H);
  auto quadIndices = ContourAnalyzer::findQuadIndices(allContours, imageArea);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 6: Filter candidates (area + convexity + aspect ratio + solidity)
  //         + NMS deduplication
  // ══════════════════════════════════════════════════════════════════════
  auto candidates = ContourAnalyzer::filterCandidates(
      allContours, quadIndices, state->minAreaPx, state->maxAreaPx,
      state->minAspectR, state->maxAspectR);
  candidates = ContourAnalyzer::removeDuplicates(candidates);

  LOGD("Frame: %zu contours → %zu quads → %zu candidates", allContours.size(),
       quadIndices.size(), candidates.size());

  // ── Update debug snapshot ──────────────────────────────────────────────
  {
    std::lock_guard<std::mutex> lock(state->debugMutex);
    state->lastDebug.allContours = allContours;
    state->lastDebug.candidateCount = static_cast<int>(candidates.size());
    state->lastDebug.candidateContours.clear();
    state->lastDebug.finalCorners.clear();

    // Collect candidate contours for visualization
    for (const auto &c : candidates) {
      if (c.contourIndex >= 0 && c.contourIndex < (int)allContours.size()) {
        state->lastDebug.candidateContours.push_back(
            allContours[c.contourIndex]);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEPS 7–12: Validate each candidate
  //   - Step 9:  Perspective warp
  //   - Step 11: Tight crop (implicit in warpToSquare → always 300×300)
  //   - Step 12: Resize to 300×300 (done in warpToSquare)
  //   - Step 11: Border check
  //   - Step 7:  Extract + validate internal grid code
  //   - Step 10: Orientation correction
  //   - Step 8:  Reject false positives (code mismatch + confidence gate)
  // ══════════════════════════════════════════════════════════════════════
  DetectionResult bestResult;
  bestResult.detected = false;

  for (const auto &candidate : candidates) {
    DetectionResult result;
    bool valid = MarkerValidator::validate(gray, candidate, *state, result);

    if (valid) {
      if (!bestResult.detected || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
      // Only process until we find a high-confidence match
      // to avoid wasting time on additional candidates
      if (bestResult.confidence >= state->highConfidenceThresh)
        break;
    }
  }

  // ── Update debug with final result ────────────────────────────────────
  if (bestResult.detected) {
    std::lock_guard<std::mutex> lock(state->debugMutex);
    state->lastDebug.finalCorners = bestResult.corners;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Serialize result to float[]
  //
  // Format: [detected(0/1), markerId, confidence, x0,y0, x1,y1, x2,y2, x3,y3]
  // Total:  10 floats when detected, 3 floats when not detected
  //
  // Corners are returned in ORIGINAL camera frame coordinates
  // (scaled back up from the 640×480 processing space).
  // ══════════════════════════════════════════════════════════════════════
  if (!bestResult.detected) {
    jfloatArray out = env->NewFloatArray(3);
    float data[3] = {0.f, -1.f, 0.f};
    env->SetFloatArrayRegion(out, 0, 3, data);
    return out;
  }

  jfloatArray out = env->NewFloatArray(10);
  float data[10];
  data[0] = 1.f; // detected = true
  data[1] = static_cast<float>(bestResult.markerId);
  data[2] = bestResult.confidence;

  for (int i = 0; i < 4; ++i) {
    // Scale corners back to original frame coordinates
    data[3 + i * 2] = bestResult.corners[i].x * scaleX;
    data[3 + i * 2 + 1] = bestResult.corners[i].y * scaleY;
  }

  env->SetFloatArrayRegion(out, 0, 10, data);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// JNI: Get debug contour data for HUD visualization
//
// Returns a compact float array encoding all contour points:
//   [totalContours,
//    numCandidateContours,
//    numAllContours,
//    (candidateContours: [numPts, x0,y0, x1,y1, ...], ...),
//    hasFinalCorners, x0,y0, x1,y1, x2,y2, x3,y3]
// ─────────────────────────────────────────────────────────────────────────────

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_markerdetectorapp_opencv_MarkerDetectorModule_nativeGetDebugData(
    JNIEnv *env, jobject /* this */, jlong nativeHandle) {
  if (nativeHandle == 0)
    return env->NewFloatArray(0);

  auto *state = reinterpret_cast<DetectorState *>(nativeHandle);

  std::lock_guard<std::mutex> lock(state->debugMutex);
  const auto &debug = state->lastDebug;

  // Compute total size needed
  size_t totalSize = 3; // Header: [totalContours, numCandidates, numAll]
  for (const auto &contour : debug.candidateContours) {
    totalSize += 1 + contour.size() * 2; // [numPts, x0,y0, x1,y1, ...]
  }
  totalSize += 1 + 8; // hasFinalCorners + 4 corner pairs

  std::vector<float> buf;
  buf.reserve(totalSize);

  buf.push_back(static_cast<float>(debug.candidateCount));
  buf.push_back(static_cast<float>(debug.candidateContours.size()));
  buf.push_back(static_cast<float>(debug.allContours.size()));

  // Candidate contours (for blue overlay)
  for (const auto &contour : debug.candidateContours) {
    buf.push_back(static_cast<float>(contour.size()));
    for (const auto &pt : contour) {
      buf.push_back(static_cast<float>(pt.x));
      buf.push_back(static_cast<float>(pt.y));
    }
  }

  // Final corners (for green overlay)
  bool hasFinal = !debug.finalCorners.empty();
  buf.push_back(hasFinal ? 1.f : 0.f);
  if (hasFinal) {
    for (const auto &pt : debug.finalCorners) {
      buf.push_back(pt.x);
      buf.push_back(pt.y);
    }
  } else {
    for (int i = 0; i < 8; ++i)
      buf.push_back(0.f);
  }

  jfloatArray out = env->NewFloatArray(static_cast<jsize>(buf.size()));
  env->SetFloatArrayRegion(out, 0, static_cast<jsize>(buf.size()), buf.data());
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// JNI: Release native resources
// ─────────────────────────────────────────────────────────────────────────────

extern "C" JNIEXPORT void JNICALL
Java_com_markerdetectorapp_opencv_MarkerDetectorModule_nativeRelease(
    JNIEnv * /* env */, jobject /* this */, jlong nativeHandle) {
  if (nativeHandle != 0) {
    auto *state = reinterpret_cast<DetectorState *>(nativeHandle);
    delete state;
    LOGI("nativeRelease: Native resources freed");
  }
}
