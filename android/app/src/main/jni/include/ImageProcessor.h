/**
 * ImageProcessor.h — Steps 1–3 of the detection pipeline.
 *
 * Steps:
 *   1. YUV → Grayscale
 *   2. Gaussian blur (noise suppression)
 *   3. Adaptive threshold (binarization)
 */
#pragma once

#include <opencv2/core.hpp>

namespace ImageProcessor {

/**
 * Convert a YUV NV21 frame to grayscale.
 *
 * WHY NV21 → Grayscale directly:
 *   NV21 layout: [Y plane (W×H bytes)] [UV interleaved (W×H/2 bytes)]
 *   The Y plane IS the grayscale image — just take the first W×H bytes.
 *   This avoids a full YUV→RGB→GRAY conversion chain (saves ~2ms per frame).
 *
 * @param yuvData   Pointer to raw NV21 byte buffer
 * @param width     Frame width in pixels
 * @param height    Frame height in pixels
 * @return          Grayscale cv::Mat (CV_8UC1), not a copy — views into yuvData
 */
cv::Mat yuvToGray(const uint8_t* yuvData, int width, int height);

/**
 * Downsample a grayscale image to processWidth × processHeight using INTER_AREA.
 *
 * WHY INTER_AREA for downscaling:
 *   INTER_AREA computes the average of contributing pixels in the source area.
 *   For significant downsampling (4× or more), it gives the sharpest result
 *   and avoids the moiré patterns that INTER_LINEAR produces.
 *   It is slower than nearest-neighbor but the quality improvement is critical
 *   for feature detection on the downsampled frame.
 *
 * @param gray          Full-resolution grayscale input
 * @param processWidth  Target width (default 640)
 * @param processHeight Target height (default 480)
 * @return              Downsampled grayscale image
 */
cv::Mat downsample(const cv::Mat& gray, int processWidth = 640, int processHeight = 480);

/**
 * Apply Gaussian blur to suppress sensor noise before thresholding.
 *
 * WHY blur BEFORE threshold:
 *   Camera sensors introduce shot noise (random pixel variation).
 *   Without blurring, thresholding produces speckled binary images with
 *   hundreds of tiny false-positive contours. A 5×5 Gaussian kernel at σ=0
 *   (auto) removes noise while preserving marker edges.
 *
 * WHY 5×5 kernel:
 *   3×3 is too small to suppress Bayer-pattern noise from the demosaicing step.
 *   7×7 is too aggressive and blurs the thin border lines of small markers.
 *   5×5 is the empirically best balance for markers in the 500–50000 px² range.
 *
 * @param gray  Grayscale input
 * @return      Blurred grayscale image
 */
cv::Mat applyGaussianBlur(const cv::Mat& gray);

/**
 * Binarize using adaptive thresholding.
 *
 * WHY adaptive threshold instead of global Otsu:
 *   Physical markers are rarely evenly lit. Under-desk lighting, shadows,
 *   camera vignetting, and screen glare create large local brightness
 *   variations. A single global threshold fails in half-lit scenes.
 *
 *   Adaptive thresholding computes a different threshold for each pixel
 *   based on a local neighbourhood, making it illumination-invariant.
 *
 * Parameters:
 *   Method:      ADAPTIVE_THRESH_MEAN_C — threshold = local_mean - C
 *   Block size:  51 pixels — covers the width of the border cells at typical
 *                detection distances (0.5–2m).
 *   C:           7 — subtracts a constant to ensure the border is classified
 *                as foreground even when there's mild contrast gradient.
 *
 * WHY THRESH_BINARY_INV:
 *   OpenCV findContours works best with WHITE foreground on BLACK background.
 *   Inverting makes the black marker borders appear as white contours,
 *   which is exactly what the contour finder expects.
 *
 * @param blurred   Blurred grayscale input
 * @return          Binary image (CV_8UC1): foreground = 255, background = 0
 */
cv::Mat adaptiveThreshold(const cv::Mat& blurred);

/**
 * Apply morphological closing to close small gaps in contours.
 *
 * WHY closing (dilate then erode):
 *   Adaptive threshold can leave tiny gaps in the square border when the
 *   marker is printed on slightly textured paper or photographed at a shallow
 *   angle. A 3×3 closing operation fills these gaps without significantly
 *   altering contour shapes.
 *
 * @param binary    Binary image from adaptiveThreshold
 * @return          Morphologically cleaned binary image
 */
cv::Mat morphClose(const cv::Mat& binary);

} // namespace ImageProcessor
