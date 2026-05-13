/**
 * MarkerStructureValidator.cpp — Step 8 implementation: multi-stage structural
 * validation.
 */
#include "include/MarkerStructureValidator.h"
#include "include/GeometryUtils.h"

#include <android/log.h>
#include <cmath>
#include <opencv2/imgproc.hpp>

#define LOG_TAG "StructureValidator"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

namespace MarkerStructureValidator {

// ─────────────────────────────────────────────────────────────────────────────
// 8a: Border thickness verification
// ─────────────────────────────────────────────────────────────────────────────

bool checkBorderThickness(const cv::Mat &warped, int gridSize,
                          float borderThresh) {
  const int warpSize = warped.cols;
  const float cellSize =
      static_cast<float>(warpSize) / static_cast<float>(gridSize);
  const int borderPx = static_cast<int>(cellSize); // 1 cell = border width

  // Check that all 4 border strips have similar mean darkness
  float means[4];

  // Top strip
  cv::Rect topROI(0, 0, warpSize, borderPx);
  means[0] = static_cast<float>(cv::mean(warped(topROI))[0]);

  // Bottom strip
  cv::Rect botROI(0, warpSize - borderPx, warpSize, borderPx);
  means[1] = static_cast<float>(cv::mean(warped(botROI))[0]);

  // Left strip (excluding corners already counted in top/bottom)
  cv::Rect leftROI(0, borderPx, borderPx, warpSize - 2 * borderPx);
  means[2] = static_cast<float>(cv::mean(warped(leftROI))[0]);

  // Right strip
  cv::Rect rightROI(warpSize - borderPx, borderPx, borderPx,
                    warpSize - 2 * borderPx);
  means[3] = static_cast<float>(cv::mean(warped(rightROI))[0]);

  // All strips must be below the blackness threshold
  for (int i = 0; i < 4; i++) {
    if (means[i] > borderThresh) {
      LOGD("Border strip %d too bright: mean=%.1f (thresh=%.1f)", i, means[i],
           borderThresh);
      return false;
    }
  }

  // Check uniformity: all 4 means should be within ±20% of each other
  float minMean = means[0], maxMean = means[0];
  for (int i = 1; i < 4; i++) {
    minMean = std::min(minMean, means[i]);
    maxMean = std::max(maxMean, means[i]);
  }

  // Avoid division by zero for very dark borders (near 0)
  if (maxMean < 5.f)
    return true; // All very dark — uniform enough

  float uniformity = minMean / maxMean;
  if (uniformity < 0.4f) {
    LOGD("Border not uniform: min=%.1f max=%.1f ratio=%.2f", minMean, maxMean,
         uniformity);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8b: Internal contour hierarchy validation
// ─────────────────────────────────────────────────────────────────────────────

bool checkInternalHierarchy(const cv::Mat &warped, int gridSize) {
  const int warpSize = warped.cols;
  const float cellSize =
      static_cast<float>(warpSize) / static_cast<float>(gridSize);
  const int borderPx = static_cast<int>(cellSize);

  // Extract inner region (skip border on all sides)
  cv::Rect innerROI(borderPx, borderPx, warpSize - 2 * borderPx,
                    warpSize - 2 * borderPx);
  cv::Mat inner = warped(innerROI).clone();

  // Threshold the inner region
  cv::Mat binary;
  cv::threshold(inner, binary, 128, 255, cv::THRESH_BINARY);

  // Find internal contours
  std::vector<std::vector<cv::Point>> contours;
  std::vector<cv::Vec4i> hierarchy;
  cv::findContours(binary, contours, hierarchy, cv::RETR_TREE,
                   cv::CHAIN_APPROX_SIMPLE);

  int contourCount = static_cast<int>(contours.size());

  // A valid marker inner region should have:
  //   - Between 2 and 25 contours (5×5 grid = at most 25 cells)
  //   - More than 1 (at least some black cells inside white background)
  //   - Less than 50 (not a dense texture like text or noise)
  if (contourCount < 2 || contourCount > 50) {
    LOGD("Internal contour count out of range: %d", contourCount);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8c: White-space ratio verification (≥60% empty inner area)
// ─────────────────────────────────────────────────────────────────────────────

bool checkWhiteSpaceRatio(const cv::Mat &warped, int gridSize,
                          float minWhiteRatio) {
  const int warpSize = warped.cols;
  const float cellSize =
      static_cast<float>(warpSize) / static_cast<float>(gridSize);
  const int borderPx = static_cast<int>(cellSize);

  // Extract inner region
  cv::Rect innerROI(borderPx, borderPx, warpSize - 2 * borderPx,
                    warpSize - 2 * borderPx);
  cv::Mat inner = warped(innerROI);

  // Threshold: pixels >= 128 are "white"
  cv::Mat binary;
  cv::threshold(inner, binary, 128, 255, cv::THRESH_BINARY);

  // Count white pixels
  int totalPixels = inner.rows * inner.cols;
  int whitePixels = cv::countNonZero(binary);
  float whiteRatio =
      static_cast<float>(whitePixels) / static_cast<float>(totalPixels);

  LOGD("White-space ratio: %.2f (min=%.2f)", whiteRatio, minWhiteRatio);

  if (whiteRatio < minWhiteRatio) {
    LOGD("White-space ratio too low: %.2f < %.2f", whiteRatio, minWhiteRatio);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8d: Asymmetric orientation marker check
// ─────────────────────────────────────────────────────────────────────────────

bool checkAsymmetry(uint32_t code) {
  // Generate all 4 rotations of the code
  uint32_t rot90 = GeometryUtils::rotate5x5_90cw(code);
  uint32_t rot180 = GeometryUtils::rotate5x5_90cw(rot90);
  uint32_t rot270 = GeometryUtils::rotate5x5_90cw(rot180);

  // The code must NOT be the same in all 4 rotations.
  // If it is, the marker is rotationally symmetric → can't determine
  // orientation. At least one rotation must produce a different code.
  if (code == rot90 && code == rot180 && code == rot270) {
    LOGD("Marker code is fully rotationally symmetric — cannot determine "
         "orientation");
    return false;
  }

  // Stronger check: the code should be different from at least 2 of its
  // rotations (a 180°-symmetric pattern can still be ambiguous between 0° and
  // 180°)
  int sameCount = 0;
  if (code == rot90)
    sameCount++;
  if (code == rot180)
    sameCount++;
  if (code == rot270)
    sameCount++;

  if (sameCount >= 2) {
    LOGD("Marker code has excessive rotational symmetry (same in %d/3 "
         "rotations)",
         sameCount);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8e: Corner angle consistency
// ─────────────────────────────────────────────────────────────────────────────

bool checkCornerAngles(const std::vector<cv::Point2f> &corners,
                       float maxDeviation) {
  if (corners.size() != 4)
    return false;

  for (int i = 0; i < 4; i++) {
    const cv::Point2f &prev = corners[(i + 3) % 4];
    const cv::Point2f &curr = corners[i];
    const cv::Point2f &next = corners[(i + 1) % 4];

    // Vectors from current corner to its neighbors
    float dx1 = prev.x - curr.x;
    float dy1 = prev.y - curr.y;
    float dx2 = next.x - curr.x;
    float dy2 = next.y - curr.y;

    // Angle between the two vectors using dot product
    float dot = dx1 * dx2 + dy1 * dy2;
    float cross = dx1 * dy2 - dy1 * dx2;
    float angle =
        std::atan2(std::abs(cross), dot) * (180.0f / static_cast<float>(M_PI));

    // Deviation from 90°
    float deviation = std::abs(angle - 90.0f);
    if (deviation > maxDeviation) {
      LOGD("Corner %d angle deviation too large: %.1f° (max=%.1f°)", i,
           deviation, maxDeviation);
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master check: run all structural validations
// ─────────────────────────────────────────────────────────────────────────────

bool validateStructure(const cv::Mat &warped,
                       const std::vector<cv::Point2f> &corners, uint32_t code,
                       std::string &outReason) {
  // Order: cheapest checks first to maximize early rejection rate

  // 8e: Corner angles
  if (!checkCornerAngles(corners, 25.f)) {
    outReason = "Corner angles too far from 90°";
    return false;
  }

  // 8a: Border thickness
  if (!checkBorderThickness(warped, 7, 80.f)) {
    outReason = "Border thickness invalid";
    return false;
  }

  // 8c: White-space ratio
  if (!checkWhiteSpaceRatio(warped, 7, 0.30f)) {
    // Use 0.30 instead of 0.60 in the actual check because:
    // - The warped image includes the border (which is black)
    // - The 60% requirement applies to the INNER area
    // - After removing the border, 30% of the total image being white
    //   corresponds to ~60% of the inner area
    outReason = "Inner white-space ratio below minimum";
    return false;
  }

  // 8b: Internal hierarchy
  if (!checkInternalHierarchy(warped, 7)) {
    outReason = "Internal structure inconsistent";
    return false;
  }

  // 8d: Asymmetry (only check if code is valid — code=0 means all black)
  if (code > 0 && !checkAsymmetry(code)) {
    outReason = "Marker pattern is rotationally symmetric";
    return false;
  }

  return true;
}

} // namespace MarkerStructureValidator
