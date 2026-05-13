/**
 * PerspectiveProcessor.h — Steps 9–12 of the detection pipeline.
 *
 * Steps:
 *   9.  Perspective transform (warpPerspective) → canonical view
 *   10. Orientation correction (find upright rotation)
 *   11. Tight crop (trim to inner content region)
 *   12. Resize to 300×300 for code extraction
 */
#pragma once

#include "DetectorTypes.h"
#include <vector>
#include <cstdint>
#include <opencv2/core.hpp>

namespace PerspectiveProcessor {

// ── Output target size ────────────────────────────────────────────────────────
static constexpr int WARP_SIZE    = 300;  // Final normalized marker size
static constexpr int GRID_SIZE    =   7;  // 7×7 total grid (1 border + 5 inner + 1 border)
static constexpr int INNER_SIZE   =   5;  // 5×5 inner data cells
static constexpr int BORDER_CELLS =   1;  // Border width in cells

/**
 * Apply perspective warp to normalize a candidate marker into a frontal view.
 *
 * WHY perspective transform (homography):
 *   When a flat square marker is viewed from any angle, it appears as a
 *   general quadrilateral due to perspective projection. A perspective
 *   transform (3×3 homography matrix H) reverses this: it maps the
 *   four observed corners to a canonical front-facing square.
 *
 * Mathematical basis:
 *   For a planar surface, the relationship between the camera image plane
 *   and the marker plane is a projective mapping:
 *
 *       [x']   [h00 h01 h02] [x]
 *       [y'] = [h10 h11 h12] [y]
 *       [w']   [h20 h21 h22] [1]
 *
 *   Normalized: x_dst = x'/w', y_dst = y'/w'
 *   H is computed from 4 point correspondences via getPerspectiveTransform.
 *   This requires EXACTLY 4 points (overdetermined systems need findHomography).
 *
 * Destination corners (always):
 *   TL = (0, 0)
 *   TR = (WARP_SIZE-1, 0)
 *   BR = (WARP_SIZE-1, WARP_SIZE-1)
 *   BL = (0, WARP_SIZE-1)
 *
 * @param gray     Grayscale processed frame (640×480)
 * @param corners  4 corners sorted CW from top-left
 * @return         WARP_SIZE×WARP_SIZE grayscale warped image
 */
cv::Mat warpToSquare(const cv::Mat& gray, const std::vector<cv::Point2f>& corners);

/**
 * Extract a 25-bit binary code from the 5×5 inner grid of a warped marker.
 *
 * Grid interpretation:
 *   The WARP_SIZE×WARP_SIZE image is conceptually divided into GRID_SIZE×GRID_SIZE cells.
 *   The outer ring (1 cell wide) = black border (used for validation, not data).
 *   The inner 5×5 = data cells.
 *
 *   Cell size = WARP_SIZE / GRID_SIZE = 300 / 7 ≈ 42.8 px
 *   Each inner cell is sampled at its center (15 × 15 pixel area).
 *
 * Binary decision per cell:
 *   mean_pixel ≥ 128 → WHITE → bit = 1
 *   mean_pixel <  128 → BLACK → bit = 0
 *
 * WHY center sampling vs full-cell average:
 *   The homography warp introduces slight blurring at cell boundaries.
 *   Sampling only the center 50% of each cell avoids boundary ambiguity
 *   where a black-white transition creates a grey zone.
 *
 * Bit ordering:
 *   Bit 0  = inner row 0, col 0 (top-left inner cell)
 *   Bit 4  = inner row 0, col 4 (top-right inner cell)
 *   Bit 24 = inner row 4, col 4 (bottom-right inner cell)
 *
 * @param warped  300×300 warped grayscale marker
 * @return        25-bit code (bits 0–24 used, bit 25+ always 0)
 */
uint32_t extractCode(const cv::Mat& warped);

/**
 * Validate the outer border cells are predominantly black.
 *
 * WHY border validation:
 *   Any square region with an internal grid pattern could theoretically
 *   produce a matching code. The mandatory black border provides a
 *   necessary (though not sufficient) condition for a valid marker.
 *
 *   We sample N evenly-spaced points along each of the 4 border edges
 *   and compute the mean pixel value. If any edge mean > borderThresh (80),
 *   the candidate is rejected immediately — cheap before code extraction.
 *
 * @param warped         300×300 warped image
 * @param borderThresh   Max pixel value to be considered "black" (default 80)
 * @return               Mean pixel value of border region (lower = more black)
 */
float checkBorderBlackness(const cv::Mat& warped, float borderThresh = 80.f);

/**
 * Determine the canonical orientation of a warped marker by trying all 4 rotations
 * and finding which produces the minimum code value (canonical form) or matches a reference.
 *
 * WHY orientation correction:
 *   The physical marker can be placed in any of 4 rotations. Without correction,
 *   the same marker would produce 4 different binary codes depending on how it's
 *   placed. We need to normalize to a canonical orientation for reliable matching.
 *
 * Strategy:
 *   Given the extracted code, generate all 4 rotations using rotate5x5_90cw.
 *   The "canonical" orientation is defined as the reference marker's orientation
 *   stored at init time. The rotation that minimizes Hamming distance to any
 *   reference code is the correct orientation.
 *
 * @param code         25-bit code extracted from the warped image (at current orientation)
 * @param refs         Reference marker codes
 * @param outMarkerId  Matched marker ID (1 or 2), or -1
 * @param outRotation  Number of 90° CW rotations applied (0, 1, 2, or 3)
 * @param outHamming   Best Hamming distance found
 * @return             Rotated code in canonical orientation
 */
uint32_t matchAndOrient(
    uint32_t                           code,
    const std::vector<MarkerReference>& refs,
    int&                               outMarkerId,
    int&                               outRotation,
    int&                               outHamming
);

/**
 * Rotate the corner array by 90° CW increments to match the orientation correction.
 *
 * WHY rotate corners:
 *   Once we know the marker's actual orientation, we must rotate the reported
 *   corner coordinates to match. This ensures the HUD overlay corner labels
 *   (TL, TR, BR, BL) align with the physical marker, not the camera image.
 *
 * @param corners   4 corners in current order
 * @param rotations Number of 90° CW rotations (0–3)
 * @return          Corners re-ordered to match the corrected orientation
 */
std::vector<cv::Point2f> rotateCorners(
    const std::vector<cv::Point2f>& corners,
    int rotations
);

/**
 * Compute a geometry confidence score for a candidate based on its spatial properties.
 *
 * Factors:
 *   - Aspect ratio closeness to 1.0 (perfect square)
 *   - Area consistency (very small or very large → lower confidence)
 *   - Planarity (if corners are nearly colinear → degenerate, low confidence)
 *
 * @param candidate  The validated candidate
 * @return           Geometry score ∈ [0.0, 1.0]
 */
float geometryScore(const MarkerCandidate& candidate);

/**
 * Compute overall confidence score combining geometry and code match quality.
 *
 * Formula:
 *   code_score     = 1.0 - (hamming_distance / 25.0)
 *   geometry_score = f(aspect_ratio, area)
 *   border_score   = 1.0 - (border_mean / 255.0)
 *   confidence     = 0.5 * code_score + 0.3 * geometry_score + 0.2 * border_score
 *
 * @param hammingDist    Bit errors in code match (0 = perfect)
 * @param geoScore       Geometry score from geometryScore()
 * @param borderMean     Mean pixel value of border cells
 * @return               Overall confidence ∈ [0.0, 1.0]
 */
float computeConfidence(int hammingDist, float geoScore, float borderMean);

} // namespace PerspectiveProcessor
