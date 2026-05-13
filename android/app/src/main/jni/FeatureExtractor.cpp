/**
 * FeatureExtractor.cpp — Steps 4–6: Contour analysis pipeline (ContourAnalyzer).
 *
 * FILE NOTE: This file is named FeatureExtractor.cpp for CMake continuity,
 * but it implements the ContourAnalyzer namespace.
 */
#include "include/ContourAnalyzer.h"
#include "include/GeometryUtils.h"

#include <opencv2/imgproc.hpp>
#include <algorithm>
#include <cmath>

namespace ContourAnalyzer {

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Find external contours
// ─────────────────────────────────────────────────────────────────────────────

std::vector<std::vector<cv::Point>> findContours(const cv::Mat& binary) {
    std::vector<std::vector<cv::Point>> contours;
    // hierarchy unused — we only care about external contours
    std::vector<cv::Vec4i> hierarchy;

    cv::findContours(
        binary,
        contours,
        hierarchy,
        cv::RETR_EXTERNAL,       // External only — ignore nested shapes
        cv::CHAIN_APPROX_SIMPLE  // Store only segment endpoints, not every point
    );
    return contours;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: approxPolyDP — find quadrilateral contours
// ─────────────────────────────────────────────────────────────────────────────

std::vector<int> findQuadIndices(
    const std::vector<std::vector<cv::Point>>& contours,
    float imageArea)
{
    std::vector<int> quadIndices;
    quadIndices.reserve(32);  // Pre-allocate: typical frames have 10–50 quads

    for (int i = 0; i < static_cast<int>(contours.size()); ++i) {
        const auto& contour = contours[i];

        // Early reject: too few points to be a quad (< 4 vertices)
        if (contour.size() < 4) continue;

        // Compute perimeter for epsilon scaling
        float perimeter = static_cast<float>(
            cv::arcLength(contour, true)  // true = closed contour
        );

        // Epsilon = 4% of perimeter
        // Douglas-Peucker simplifies until all points are within epsilon of
        // the simplified polyline. 4% = ~1 corner-rounding unit for printed markers.
        float epsilon = 0.04f * perimeter;

        std::vector<cv::Point> approx;
        cv::approxPolyDP(contour, approx, epsilon, true /* closed */);

        // Keep only quadrilaterals (exactly 4 vertices after approximation)
        if (approx.size() == 4) {
            quadIndices.push_back(i);
        }
    }
    return quadIndices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Filter candidates
// ─────────────────────────────────────────────────────────────────────────────

std::vector<MarkerCandidate> filterCandidates(
    const std::vector<std::vector<cv::Point>>& contours,
    const std::vector<int>&                    quadIndices,
    float minAreaPx,
    float maxAreaPx,
    float minAspectR,
    float maxAspectR)
{
    std::vector<MarkerCandidate> candidates;
    candidates.reserve(quadIndices.size());

    for (int idx : quadIndices) {
        const auto& contour = contours[idx];

        // ── Filter 1: area bounds ───────────────────────────────────────────
        float area = static_cast<float>(cv::contourArea(contour));
        if (area < minAreaPx || area > maxAreaPx) continue;

        // ── Filter 2: convexity ─────────────────────────────────────────────
        // A physical square is always convex. Non-convex shapes (L, U, zigzag)
        // are structural elements, not markers.
        if (!cv::isContourConvex(contour)) continue;

        // Re-approximate with same epsilon to get 4-point polygon
        float perimeter = static_cast<float>(cv::arcLength(contour, true));
        std::vector<cv::Point> approx;
        cv::approxPolyDP(contour, approx, 0.04f * perimeter, true);
        if (approx.size() != 4) continue;  // Shouldn't happen, but be safe

        // Convert to float corners
        std::vector<cv::Point2f> corners;
        corners.reserve(4);
        for (const auto& p : approx) {
            corners.emplace_back(static_cast<float>(p.x), static_cast<float>(p.y));
        }

        // Sort corners clockwise from top-left
        corners = GeometryUtils::sortCornersClockwise(corners);

        // ── Filter 3: aspect ratio ──────────────────────────────────────────
        float ar = GeometryUtils::quadAspectRatio(corners);
        if (ar < minAspectR || ar > maxAspectR) continue;

        // ── Filter 4: solidity (area / convex hull area) ────────────────────
        // Solidity close to 1.0 = "solid" shape (not a frame or ring).
        // Threshold: 0.85 — accepts slightly indented shapes from ink bleeding.
        std::vector<cv::Point> hull;
        cv::convexHull(contour, hull);
        float hullArea = static_cast<float>(cv::contourArea(hull));
        float solidity = (hullArea > 0.f) ? area / hullArea : 0.f;
        if (solidity < 0.85f) continue;

        // ── Candidate accepted ──────────────────────────────────────────────
        MarkerCandidate candidate;
        candidate.corners      = corners;
        candidate.area         = area;
        candidate.aspectRatio  = ar;
        candidate.isConvex     = true;
        candidate.contourIndex = idx;
        candidates.push_back(candidate);
    }

    // Sort by area descending so larger (closer) markers are processed first
    std::sort(candidates.begin(), candidates.end(),
        [](const MarkerCandidate& a, const MarkerCandidate& b) {
            return a.area > b.area;
        });

    return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate rejection (NMS)
// ─────────────────────────────────────────────────────────────────────────────

std::vector<MarkerCandidate> removeDuplicates(
    const std::vector<MarkerCandidate>& candidates)
{
    std::vector<bool> suppressed(candidates.size(), false);
    std::vector<MarkerCandidate> result;
    result.reserve(candidates.size());

    for (int i = 0; i < static_cast<int>(candidates.size()); ++i) {
        if (suppressed[i]) continue;

        cv::Rect rectI = GeometryUtils::boundingRect(candidates[i].corners);

        for (int j = i + 1; j < static_cast<int>(candidates.size()); ++j) {
            if (suppressed[j]) continue;
            cv::Rect rectJ = GeometryUtils::boundingRect(candidates[j].corners);

            float overlap = GeometryUtils::iou(rectI, rectJ);
            if (overlap > 0.5f) {
                // Suppress the smaller one (already sorted by area desc, so suppress j)
                suppressed[j] = true;
            }
        }

        if (!suppressed[i]) {
            result.push_back(candidates[i]);
        }
    }

    return result;
}

} // namespace ContourAnalyzer
