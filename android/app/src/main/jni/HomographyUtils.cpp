/**
 * HomographyUtils.cpp — Steps 9–12: Perspective transform pipeline (PerspectiveProcessor).
 *
 * FILE NOTE: Named HomographyUtils.cpp for CMake continuity.
 */
#include "include/PerspectiveProcessor.h"
#include "include/GeometryUtils.h"

#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>
#include <cmath>
#include <algorithm>
#include <android/log.h>

#define LOG_TAG "PerspectiveProcessor"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)

namespace PerspectiveProcessor {

// ─────────────────────────────────────────────────────────────────────────────
// Step 9: Perspective warp → canonical frontal view
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat warpToSquare(const cv::Mat& gray, const std::vector<cv::Point2f>& corners) {
    // Destination: WARP_SIZE × WARP_SIZE square
    // Corners ordered: TL, TR, BR, BL (clockwise, same as input)
    std::vector<cv::Point2f> dst = {
        { 0.f,                 0.f                 },  // TL
        { WARP_SIZE - 1.f,     0.f                 },  // TR
        { WARP_SIZE - 1.f,     WARP_SIZE - 1.f     },  // BR
        { 0.f,                 WARP_SIZE - 1.f     },  // BL
    };

    // getPerspectiveTransform computes H exactly from 4 point pairs.
    // This is fast (closed-form solution, no iteration).
    // WHY not findHomography: findHomography uses RANSAC which requires 8+ points
    // and is designed for noisy/outlier-contaminated correspondences.
    // We have exactly 4 points with no outliers → use the exact solution.
    cv::Mat H = cv::getPerspectiveTransform(corners, dst);

    cv::Mat warped;
    cv::warpPerspective(
        gray,
        warped,
        H,
        cv::Size(WARP_SIZE, WARP_SIZE),
        cv::INTER_LINEAR,      // Linear interpolation for smooth warp
        cv::BORDER_CONSTANT,   // Fill outside with 0 (black)
        cv::Scalar(0)
    );

    return warped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 12 (inner): Extract 25-bit code from 5×5 inner grid
// ─────────────────────────────────────────────────────────────────────────────

uint32_t extractCode(const cv::Mat& warped) {
    // Cell dimensions in pixels
    const float cellSize = static_cast<float>(WARP_SIZE) / static_cast<float>(GRID_SIZE);
    // Center sampling region: inner 50% of each cell to avoid boundary blur
    const float sampleMargin = cellSize * 0.25f;  // 25% inset on each side

    uint32_t code = 0;
    int      bitIdx = 0;  // Bit 0 = top-left inner cell

    for (int innerRow = 0; innerRow < INNER_SIZE; ++innerRow) {
        for (int innerCol = 0; innerCol < INNER_SIZE; ++innerCol) {
            // Translate inner grid coordinates to pixel coordinates.
            // The border is 1 cell wide, so inner cell (0,0) starts at pixel
            // (cellSize * BORDER_CELLS, cellSize * BORDER_CELLS).
            float cellX = cellSize * (BORDER_CELLS + innerCol);
            float cellY = cellSize * (BORDER_CELLS + innerRow);

            // Sample region (inset for boundary safety)
            int x0 = static_cast<int>(cellX + sampleMargin);
            int y0 = static_cast<int>(cellY + sampleMargin);
            int x1 = static_cast<int>(cellX + cellSize - sampleMargin);
            int y1 = static_cast<int>(cellY + cellSize - sampleMargin);

            // Clamp to image bounds
            x0 = std::max(0, std::min(x0, WARP_SIZE - 1));
            y0 = std::max(0, std::min(y0, WARP_SIZE - 1));
            x1 = std::max(x0 + 1, std::min(x1, WARP_SIZE));
            y1 = std::max(y0 + 1, std::min(y1, WARP_SIZE));

            // Compute mean pixel value in the sample region
            cv::Rect roi(x0, y0, x1 - x0, y1 - y0);
            cv::Scalar mean = cv::mean(warped(roi));
            float meanVal = static_cast<float>(mean[0]);

            // Binary decision: WHITE (>= 128) → 1, BLACK (< 128) → 0
            if (meanVal >= 128.f) {
                code |= (1u << bitIdx);
            }
            ++bitIdx;
        }
    }

    return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 11: Border blackness check (false positive rejection)
// ─────────────────────────────────────────────────────────────────────────────

float checkBorderBlackness(const cv::Mat& warped, float borderThresh) {
    const float cellSize = static_cast<float>(WARP_SIZE) / static_cast<float>(GRID_SIZE);
    const int   border   = static_cast<int>(cellSize);  // 1 cell = border width

    // Sample 4 border strips: top, bottom, left, right
    float totalMean = 0.f;
    int   samples   = 0;

    auto sampleStrip = [&](cv::Rect roi) {
        roi.x = std::max(0, roi.x);
        roi.y = std::max(0, roi.y);
        roi.width  = std::min(roi.width,  WARP_SIZE - roi.x);
        roi.height = std::min(roi.height, WARP_SIZE - roi.y);
        if (roi.width <= 0 || roi.height <= 0) return;

        cv::Scalar m = cv::mean(warped(roi));
        totalMean += static_cast<float>(m[0]);
        ++samples;
    };

    // Top border strip
    sampleStrip(cv::Rect(0, 0, WARP_SIZE, border));
    // Bottom border strip
    sampleStrip(cv::Rect(0, WARP_SIZE - border, WARP_SIZE, border));
    // Left border strip
    sampleStrip(cv::Rect(0, border, border, WARP_SIZE - 2 * border));
    // Right border strip
    sampleStrip(cv::Rect(WARP_SIZE - border, border, border, WARP_SIZE - 2 * border));

    return (samples > 0) ? totalMean / static_cast<float>(samples) : 255.f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 10: Orientation matching
// ─────────────────────────────────────────────────────────────────────────────

uint32_t matchAndOrient(
    uint32_t                            code,
    const std::vector<MarkerReference>& refs,
    int&                                outMarkerId,
    int&                                outRotation,
    int&                                outHamming)
{
    outMarkerId = -1;
    outRotation = 0;
    outHamming  = 26;  // Worse than any possible 25-bit Hamming distance

    uint32_t bestCode = code;

    // Generate all 4 rotations of the extracted code
    uint32_t rotatedCode[4];
    rotatedCode[0] = code;
    rotatedCode[1] = GeometryUtils::rotate5x5_90cw(rotatedCode[0]);
    rotatedCode[2] = GeometryUtils::rotate5x5_90cw(rotatedCode[1]);
    rotatedCode[3] = GeometryUtils::rotate5x5_90cw(rotatedCode[2]);

    // Compare against all reference codes in all orientations
    for (const auto& ref : refs) {
        for (int rot = 0; rot < 4; ++rot) {
            // The reference codes[r] represents the reference at rotation r.
            // We match rotatedCode[r] against ref.codes[0] (canonical reference).
            // Alternatively: match rotatedCode[0] against ref.codes[r]
            // (equivalent, but this form is clearer).
            int hamming = GeometryUtils::hammingDistance(rotatedCode[rot], ref.codes[0]);

            if (hamming < outHamming) {
                outHamming  = hamming;
                outMarkerId = ref.id;
                outRotation = rot;
                bestCode    = rotatedCode[rot];
            }
        }
    }

    return bestCode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotate corners to match orientation correction
// ─────────────────────────────────────────────────────────────────────────────

std::vector<cv::Point2f> rotateCorners(
    const std::vector<cv::Point2f>& corners,
    int rotations)
{
    if (corners.size() != 4 || rotations == 0) return corners;
    rotations = ((rotations % 4) + 4) % 4;  // Normalize to [0, 3]

    std::vector<cv::Point2f> result(4);
    for (int i = 0; i < 4; ++i) {
        result[i] = corners[(i + rotations) % 4];
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence scoring
// ─────────────────────────────────────────────────────────────────────────────

float geometryScore(const MarkerCandidate& candidate) {
    // Aspect ratio score: 1.0 at perfect square (ar=1.0), decays linearly
    float arScore = 1.0f - std::min(1.0f, std::abs(candidate.aspectRatio - 1.0f) / 0.33f);

    // Area score: peak at 10000 px² (typical close-range marker), decays beyond
    float normArea = candidate.area / 10000.f;
    float areaScore = std::exp(-0.5f * std::pow(std::log(normArea), 2.0f));
    areaScore = std::max(0.f, std::min(1.f, areaScore));

    return 0.6f * arScore + 0.4f * areaScore;
}

float computeConfidence(int hammingDist, float geoScore, float borderMean) {
    // Code match score: 0 errors → 1.0, 25 errors → 0.0
    float codeScore = 1.0f - (static_cast<float>(hammingDist) / 25.0f);

    // Border score: mean pixel 0 (pure black) → 1.0, mean 255 (pure white) → 0.0
    float borderScore = 1.0f - (borderMean / 255.0f);

    // Weighted combination
    float confidence = 0.5f * codeScore + 0.3f * geoScore + 0.2f * borderScore;
    return std::max(0.f, std::min(1.f, confidence));
}

} // namespace PerspectiveProcessor
