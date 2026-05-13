/**
 * DetectorTypes.h — Shared data structures for the marker detection pipeline.
 *
 * Design principles:
 * - All structs use value semantics (copyable) so pipeline stages are composable
 * - cv::Mat members use reference counting — no explicit ownership needed
 * - Coordinates are always in the PROCESSED frame space (640×480),
 *   NOT the original camera frame space. The JS layer scales back up.
 */
#pragma once

#include <vector>
#include <string>
#include <cstdint>
#include <mutex>
#include <opencv2/core.hpp>

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline intermediate: candidate square region
// Populated by ContourAnalyzer, consumed by MarkerValidator
// ─────────────────────────────────────────────────────────────────────────────
struct MarkerCandidate {
    /**
     * 4 corner points of the candidate square in the PROCESSED frame.
     * Sorted CLOCKWISE starting from the top-left corner.
     * WHY clockwise: warpPerspective's destination points must be in a
     * consistent winding order or the homography matrix will flip the image.
     */
    std::vector<cv::Point2f> corners;

    /** Contour area in pixels (processed frame space) */
    float area = 0.f;

    /**
     * Aspect ratio = longer_side / shorter_side
     * Ideal square → 1.0. We accept [0.75, 1.33].
     * WHY not 1.0 exactly: perspective foreshortening causes real squares
     * to appear as non-square quadrilaterals at oblique angles.
     */
    float aspectRatio = 0.f;

    /** OpenCV convexity test — non-convex quadrilaterals are rejected */
    bool isConvex = false;

    /**
     * Index into the contour vector from findContours.
     * Kept for debug overlay rendering.
     */
    int contourIndex = -1;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reference marker loaded at init from a Bitmap
// ─────────────────────────────────────────────────────────────────────────────
struct MarkerReference {
    int id = 0;                  // 1 or 2

    /**
     * 25-bit code from the 5×5 inner grid of the reference marker.
     * Bit i = 1 if cell i is WHITE, 0 if BLACK.
     * Cells indexed row-major: bit 0 = top-left inner cell.
     *
     * codes[0] = canonical orientation
     * codes[1] = 90° CW rotation
     * codes[2] = 180° rotation
     * codes[3] = 270° CW rotation
     * WHY all 4: we don't know which way up the physical marker is placed,
     * so we must match against all valid orientations.
     */
    uint32_t codes[4] = {0, 0, 0, 0};

    /** Raw 300×300 grayscale reference image for ORB fallback matching */
    cv::Mat referenceImage;
};

// ─────────────────────────────────────────────────────────────────────────────
// Final detection result (returned to JNI / JS)
// ─────────────────────────────────────────────────────────────────────────────
struct DetectionResult {
    bool      detected   = false;
    int       markerId   = -1;
    float     confidence = 0.f;

    /**
     * 4 corner points in PROCESSED frame coordinates (640×480 space).
     * Order: top-left, top-right, bottom-right, bottom-left (clockwise).
     * The JS layer must scale these to screen coordinates:
     *   screenX = cornerX * (screenW / processW)
     *   screenY = cornerY * (screenH / processH)
     */
    std::vector<cv::Point2f> corners;

    /**
     * Normalized 300×300 view of the detected marker after perspective warp.
     * Available for debug display; not returned to JS (too large).
     */
    cv::Mat normalizedView;

    /** Rotation applied to reach canonical orientation: 0, 90, 180, or 270 */
    int orientationDeg = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Debug data snapshot from the last processed frame
// ─────────────────────────────────────────────────────────────────────────────
struct DebugSnapshot {
    /**
     * ALL contours found by findContours (typically hundreds).
     * Rendered as thin grey lines in the debug overlay.
     */
    std::vector<std::vector<cv::Point>> allContours;

    /**
     * Contours that passed the polygon filter (4 corners + area + convexity).
     * Rendered as blue quadrilaterals in the debug overlay.
     */
    std::vector<std::vector<cv::Point>> candidateContours;

    /**
     * The validated marker corners (if any).
     * Rendered as green quadrilateral with labeled corners.
     */
    std::vector<cv::Point2f> finalCorners;

    /** Number of candidates evaluated in this frame */
    int candidateCount = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Top-level detector state — pointed to by the opaque JNI handle
// ─────────────────────────────────────────────────────────────────────────────
struct DetectorState {
    /** Reference templates, one per marker ID */
    std::vector<MarkerReference> references;

    /** Debug data from the last processed frame */
    DebugSnapshot lastDebug;

    /**
     * Mutex protecting lastDebug so the JNI "getDebugData" call (main thread)
     * doesn't race with the frame processor (worklet thread).
     */
    std::mutex debugMutex;

    // ── Detection tuning parameters ───────────────────────────────────────
    float minAreaPx     = 500.f;    // Minimum candidate area (processed px²)
    float maxAreaPx     = 150000.f; // Maximum candidate area
    float minAspectR    = 0.75f;    // Minimum side_ratio (long/short)
    float maxAspectR    = 1.33f;    // Maximum side_ratio
    float borderBlackThresh = 80.f; // Max mean pixel value for "black" border
    int   maxBitErrors  = 5;        // Max Hamming distance for code match (out of 25)
    float highConfidenceThresh = 0.85f; // Threshold for early exit in candidate loop
};
