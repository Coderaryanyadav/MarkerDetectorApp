/**
 * GeometryUtils.h — Pure geometry helpers used across pipeline stages.
 *
 * All functions are stateless and thread-safe.
 */
#pragma once

#include <cstdint>
#include <opencv2/core.hpp>
#include <vector>

namespace GeometryUtils {

// ── Distance & area
// ───────────────────────────────────────────────────────────

/** Squared Euclidean distance between two points (avoids sqrt) */
float distanceSq(const cv::Point2f &a, const cv::Point2f &b);

/** Euclidean distance */
float distance(const cv::Point2f &a, const cv::Point2f &b);

/**
 * Signed area of a polygon via the shoelace formula.
 * Positive = counter-clockwise winding, Negative = clockwise.
 */
float signedArea(const std::vector<cv::Point2f> &pts);

/** Absolute area of a quadrilateral */
float quadArea(const std::vector<cv::Point2f> &pts);

// ── Aspect ratio
// ──────────────────────────────────────────────────────────────

/**
 * Compute the aspect ratio of a quadrilateral as (max_side / min_side).
 * Returns the ratio of the LONGER side to the SHORTER side.
 * Perfect square → 1.0. Increasing values indicate non-square shapes.
 *
 * Uses average of opposite pairs to reduce noise:
 *   top_side    = dist(TL, TR)
 *   bottom_side = dist(BL, BR)
 *   left_side   = dist(TL, BL)
 *   right_side  = dist(TR, BR)
 *   avg_width   = (top_side + bottom_side) / 2
 *   avg_height  = (left_side + right_side) / 2
 */
float quadAspectRatio(const std::vector<cv::Point2f> &corners);

// ── Corner ordering
// ───────────────────────────────────────────────────────────

/**
 * Sort 4 corners into CLOCKWISE order starting from the TOP-LEFT corner.
 *
 * Algorithm:
 *   1. Find centroid of the 4 points.
 *   2. Sort by angle from centroid using atan2.
 *   3. Rotate the sorted array so index 0 is the top-left point
 *      (minimum x+y sum, since top-left has smallest x and y values).
 *
 * WHY this matters: warpPerspective requires consistent destination corner
 * order. If corners are in random order, the warp produces garbage.
 */
std::vector<cv::Point2f>
sortCornersClockwise(const std::vector<cv::Point2f> &pts);

/**
 * Find the index of the top-left corner in an already-clockwise-sorted array.
 * Top-left = point with minimum (x + y) value (Euclidean sense).
 */
int findTopLeftIndex(const std::vector<cv::Point2f> &corners);

// ── Intersection over Union
// ───────────────────────────────────────────────────

/**
 * Compute IoU between two axis-aligned bounding rectangles.
 * Used for duplicate detection rejection.
 *
 * IoU = intersection_area / union_area ∈ [0, 1]
 * IoU > 0.5 → significant overlap → keep only the higher-confidence one.
 */
float iou(const cv::Rect &a, const cv::Rect &b);

/**
 * Get the axis-aligned bounding rectangle of a set of points.
 */
cv::Rect boundingRect(const std::vector<cv::Point2f> &pts);

// ── Bit manipulation for 5×5 grid codes ──────────────────────────────────────

/**
 * Rotate a 5×5 binary grid (stored as 25 least-significant bits of a uint32_t)
 * by 90° clockwise.
 *
 * Grid layout:
 *   Bit 0  = row 0, col 0 (top-left)
 *   Bit 4  = row 0, col 4 (top-right)
 *   Bit 5  = row 1, col 0
 *   Bit 24 = row 4, col 4 (bottom-right)
 *
 * 90° CW rotation: new[col][4-row] = old[row][col]
 *   new_bit = (col * 5) + (4 - row)
 *
 * WHY: We need to try all 4 orientations when matching against reference codes
 * because the physical marker may be placed in any rotation.
 */
uint32_t rotate5x5_90cw(uint32_t code);

/**
 * Compute the Hamming distance (number of differing bits) between two codes.
 * Uses __builtin_popcount for a single CPU instruction on ARM/x86.
 */
int hammingDistance(uint32_t a, uint32_t b);

} // namespace GeometryUtils
