/**
 * ContourAnalyzer.h — Steps 4–6 of the detection pipeline.
 *
 * Steps:
 *   4. findContours — extract connected regions from binary image
 *   5. approxPolyDP — approximate each contour as a polygon
 *   6. Filter candidates: 4 corners, convex, square aspect ratio, area bounds
 */
#pragma once

#include "DetectorTypes.h"
#include <vector>
#include <opencv2/core.hpp>

namespace ContourAnalyzer {

/**
 * Find all external contours in a binary image.
 *
 * WHY RETR_EXTERNAL:
 *   We only want the outermost contour of each shape. The inner structure
 *   of the marker (black cells, white cells) creates interior contours that
 *   we don't want to process at this stage. RETR_EXTERNAL ignores all
 *   contours nested inside another contour.
 *
 * WHY CHAIN_APPROX_SIMPLE:
 *   Stores only the endpoints of horizontal, vertical, and diagonal segments
 *   instead of every point. This reduces memory usage by ~5–10× for the
 *   large number of contours typically found in a frame.
 *
 * @param binary  Binary image (CV_8UC1)
 * @return        All external contours (each = vector of points)
 */
std::vector<std::vector<cv::Point>> findContours(const cv::Mat& binary);

/**
 * Approximate each contour as a polygon using Douglas-Peucker algorithm.
 * Return only quadrilaterals (exactly 4 vertices).
 *
 * WHY approxPolyDP:
 *   findContours returns pixel-perfect contours that may have hundreds of
 *   points for a single square edge (due to anti-aliasing, noise, or
 *   slightly bent paper). We need to know if the shape is a quadrilateral.
 *   approxPolyDP simplifies the contour until it has ≤ N vertices while
 *   staying within epsilon distance of the original.
 *
 * WHY epsilon = 4% of perimeter:
 *   Too small (1%) → noise creates 5–8 vertex polygons from squares.
 *   Too large (10%) → rounded corners produce "4-vertex" pentagons.
 *   4% of perimeter is the empirically stable value for printed markers.
 *
 * WHY closed = true:
 *   Markers are closed shapes. Open=false would break quad detection for
 *   partially-occluded markers.
 *
 * @param contours   Raw contours from findContours
 * @param imageArea  Total image area (processW × processH) for epsilon scaling
 * @return           Indices into contours[] that are quadrilateral-shaped
 */
std::vector<int> findQuadIndices(
    const std::vector<std::vector<cv::Point>>& contours,
    float imageArea
);

/**
 * Filter quadrilateral contours to find plausible marker candidates.
 *
 * Filters applied (in order of cheapness):
 *
 *   1. AREA BOUNDS: area ∈ [minAreaPx, maxAreaPx]
 *      Rejects tiny noise contours and contours that cover most of the frame.
 *
 *   2. CONVEXITY: cv::isContourConvex()
 *      Markers are flat printed squares → always convex. Non-convex shapes
 *      are L-shapes, U-shapes, etc. — never a valid marker.
 *      WHY convexity matters: perspective-distorted squares remain convex
 *      for tilt angles up to ~75°.
 *
 *   3. ASPECT RATIO: max_side / min_side ∈ [minAspectR, maxAspectR]
 *      A square viewed at >70° tilt will have an aspect ratio > 2.
 *      We limit to 1.33 (≈60° tilt) because at steeper angles, the
 *      internal marker pattern becomes unreadable anyway.
 *
 *   4. MINIMUM SOLIDITY: area / convexHullArea > 0.85
 *      Ensures the shape is "solid" — rejects C-shapes or frames that
 *      somehow pass the convexity test due to hull computation rounding.
 *
 * @param contours    All external contours
 * @param quadIndices Indices that passed the polygon test
 * @param minAreaPx   Minimum acceptable area
 * @param maxAreaPx   Maximum acceptable area
 * @param minAspectR  Minimum aspect ratio (long/short)
 * @param maxAspectR  Maximum aspect ratio
 * @return            Filtered MarkerCandidate list
 */
std::vector<MarkerCandidate> filterCandidates(
    const std::vector<std::vector<cv::Point>>& contours,
    const std::vector<int>&                    quadIndices,
    float minAreaPx,
    float maxAreaPx,
    float minAspectR,
    float maxAspectR
);

/**
 * Remove duplicate candidates using IoU-based non-maximum suppression.
 *
 * WHY duplicates occur:
 *   findContours can return multiple contours for the same physical shape
 *   if the binary image has thin bridges between the shape and its parent.
 *   Two candidates with IoU > 0.5 refer to the same physical marker.
 *
 * Strategy: Keep the larger-area candidate (more stable for perspective warp).
 *
 * @param candidates  Raw candidate list (may contain near-duplicates)
 * @return            Deduplicated candidate list
 */
std::vector<MarkerCandidate> removeDuplicates(
    const std::vector<MarkerCandidate>& candidates
);

} // namespace ContourAnalyzer
