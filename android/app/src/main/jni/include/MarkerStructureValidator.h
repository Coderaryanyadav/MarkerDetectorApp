/**
 * MarkerStructureValidator.h — Step 8: Structural validation for false positive
 * prevention.
 *
 * This module implements the deeper structural checks that distinguish
 * a real marker from any object that merely looks square:
 *
 *   8a. Border thickness verification
 *   8b. Internal contour hierarchy validation
 *   8c. White-space ratio verification (≥60% inner area must be empty)
 *   8d. Asymmetric orientation marker verification
 *
 * These checks run on the 300×300 warped marker image AFTER perspective
 * correction but BEFORE code extraction — they're cheaper than code matching
 * and reject most false positives before we even bother with the 5×5 grid.
 */
#pragma once

#include <opencv2/core.hpp>

namespace MarkerStructureValidator {

/**
 * Step 8a: Verify that the marker has a consistent black border
 * of the expected thickness.
 *
 * Expected border = 1/7th of the total marker size (one cell in a 7×7 grid).
 * We check that:
 *   - The outer 1/7th ring is predominantly black (mean < borderThresh)
 *   - The border has uniform width (±20% tolerance along all 4 sides)
 *
 * WHY border thickness matters:
 *   Random square objects (monitors, picture frames, books) typically
 *   don't have borders that are exactly 1/7th of their width.
 *   This geometric property strongly separates markers from imposters.
 *
 * @param warped        300×300 grayscale warped marker
 * @param gridSize      Total grid divisions (7 for our markers)
 * @param borderThresh  Max pixel value for "black" (default 80)
 * @return true if border passes thickness check
 */
bool checkBorderThickness(const cv::Mat &warped, int gridSize = 7,
                          float borderThresh = 80.f);

/**
 * Step 8b: Validate internal contour hierarchy.
 *
 * A valid marker's internal region (inside the border) should contain
 * a structured pattern of black and white regions. We detect contours
 * inside the inner 5/7ths of the warped marker and verify:
 *   - There are between 4 and 20 internal contours (too few = blank,
 *     too many = noise or complex texture)
 *   - At least one contour is in the top-left quadrant (asymmetric marker
 * requirement)
 *
 * WHY hierarchy check:
 *   A white wall corner or a black frame has NO internal structure.
 *   A book page has hundreds of tiny contours (text).
 *   Only a marker with a deliberate pattern has the right contour count.
 *
 * @param warped    300×300 grayscale warped marker
 * @param gridSize  Total grid divisions (7)
 * @return true if internal structure is consistent with a marker
 */
bool checkInternalHierarchy(const cv::Mat &warped, int gridSize = 7);

/**
 * Step 8c: Verify white-space ratio.
 *
 * The spec requires minimum 60% empty (white) inner area.
 * We compute the ratio of white pixels to total pixels in the
 * inner 5×5 grid region (excluding the border).
 *
 * WHY white-space matters:
 *   Markers are designed with sparse patterns for easy recognition.
 *   Dense patterns (QR codes, barcodes, textures) would fail this check.
 *   This is a design constraint that keeps markers distinct from
 *   other common visual patterns.
 *
 * @param warped          300×300 grayscale warped marker
 * @param gridSize        Total grid divisions (7)
 * @param minWhiteRatio   Minimum fraction of white pixels (default 0.60)
 * @return true if white-space ratio meets the requirement
 */
bool checkWhiteSpaceRatio(const cv::Mat &warped, int gridSize = 7,
                          float minWhiteRatio = 0.60f);

/**
 * Step 8d: Verify asymmetric orientation marker.
 *
 * The marker design includes an asymmetric element (e.g., a filled cell
 * in only one corner of the 5×5 inner grid) that allows us to determine
 * orientation. This check verifies that the pattern is NOT rotationally
 * symmetric (i.e., the 4 rotations of the grid code are all different).
 *
 * WHY asymmetry matters:
 *   If the marker were rotationally symmetric (like a plain checkerboard),
 *   we couldn't distinguish 0° from 90° from 180° from 270°.
 *   The asymmetric element ensures unique orientation detection.
 *
 * @param code  25-bit grid code extracted from the marker
 * @return true if the code is NOT rotationally symmetric (at least one rotation
 * differs)
 */
bool checkAsymmetry(uint32_t code);

/**
 * Step 8e: Corner angle consistency.
 *
 * Verifies that all 4 interior angles of the detected quadrilateral
 * are close to 90° (within ±25° tolerance). Non-square quadrilaterals
 * have angles far from 90°.
 *
 * @param corners  4 corner points (clockwise sorted)
 * @param maxDeviation  Maximum allowed deviation from 90° (in degrees)
 * @return true if all angles are within tolerance
 */
bool checkCornerAngles(const std::vector<cv::Point2f> &corners,
                       float maxDeviation = 25.f);

/**
 * Run ALL structural validation checks on a warped marker.
 * Short-circuits on the first failure for performance.
 *
 * @param warped       300×300 grayscale warped marker
 * @param corners      4 corner points of the candidate
 * @param code         25-bit grid code (for asymmetry check)
 * @param outReason    Filled with rejection reason if false
 * @return true if all structural checks pass
 */
bool validateStructure(const cv::Mat &warped,
                       const std::vector<cv::Point2f> &corners, uint32_t code,
                       std::string &outReason);

} // namespace MarkerStructureValidator
