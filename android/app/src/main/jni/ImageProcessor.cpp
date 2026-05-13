/**
 * ImageProcessor.cpp — Steps 1–3: Preprocessing pipeline implementation.
 */
#include "include/ImageProcessor.h"

#include <opencv2/imgproc.hpp>

namespace ImageProcessor {

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: YUV NV21 → Grayscale
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat yuvToGray(const uint8_t* yuvData, int width, int height) {
    // NV21 format: Y plane (width × height bytes) followed by UV interleaved plane.
    // The Y plane is EXACTLY the luminance (grayscale) channel.
    // Creating a Mat that VIEWS the existing buffer — zero copy, zero allocation.
    // IMPORTANT: The caller must ensure yuvData outlives this Mat.
    //            In the JNI implementation, we copy before releasing the array.
    return cv::Mat(height, width, CV_8UC1, const_cast<uint8_t*>(yuvData)).clone();
    // .clone() is needed because the JNI buffer will be released after this call.
    // The clone is a single malloc + memcpy — much faster than a full color conversion.
}

// ─────────────────────────────────────────────────────────────────────────────
// Downsample for processing
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat downsample(const cv::Mat& gray, int processWidth, int processHeight) {
    if (gray.cols == processWidth && gray.rows == processHeight) {
        return gray;  // Already the right size — no copy needed
    }

    cv::Mat result;
    // INTER_AREA: computes the average of source pixels that map to each
    // destination pixel. Best for downscaling — equivalent to box filtering.
    // The alternative, INTER_LINEAR (bilinear), produces more blurry results
    // at 4× downscale ratios, which would degrade the adaptive threshold step.
    cv::resize(gray, result, cv::Size(processWidth, processHeight),
               0, 0, cv::INTER_AREA);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Gaussian blur
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat applyGaussianBlur(const cv::Mat& gray) {
    cv::Mat blurred;
    // Kernel: 5×5, sigma = 0 (OpenCV auto-computes sigma from kernel size: ~1.1)
    // borderType: BORDER_REFLECT_101 (reflects pixels at edges without repeating
    // the edge pixel itself) — avoids artificial edge artifacts.
    cv::GaussianBlur(gray, blurred, cv::Size(5, 5), 0, 0, cv::BORDER_REFLECT_101);
    return blurred;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Adaptive threshold
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat adaptiveThreshold(const cv::Mat& blurred) {
    cv::Mat binary;
    cv::adaptiveThreshold(
        blurred,
        binary,
        255,                              // Max value assigned to pixels above threshold
        cv::ADAPTIVE_THRESH_MEAN_C,       // Threshold = local_mean - C
        cv::THRESH_BINARY_INV,            // Invert: black → white (foreground for findContours)
        51,                               // Block size: 51px neighbourhood
                                          //   At 640×480, a marker border at 1m is ~20px wide.
                                          //   51 > 2×border_width → threshold adapts
                                          //   across the entire border width.
        7                                 // C constant: subtract 7 from local mean.
                                          //   Increases sensitivity for low-contrast prints.
    );
    return binary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Morphological closing
// ─────────────────────────────────────────────────────────────────────────────

cv::Mat morphClose(const cv::Mat& binary) {
    // 3×3 rectangular structuring element.
    // Closing = dilate then erode:
    //   dilate: expand white regions → closes gaps in contour borders
    //   erode:  shrink back by same amount → preserves overall shape & size
    cv::Mat kernel = cv::getStructuringElement(
        cv::MORPH_RECT, cv::Size(3, 3)
    );
    cv::Mat closed;
    cv::morphologyEx(binary, closed, cv::MORPH_CLOSE, kernel);
    return closed;
}

} // namespace ImageProcessor
