/**
 * GeometryUtils.cpp — Implementation of all geometry helper functions.
 */
#include "include/GeometryUtils.h"

#include <cmath>
#include <algorithm>
#include <numeric>
#include <opencv2/imgproc.hpp>

namespace GeometryUtils {

// ─────────────────────────────────────────────────────────────────────────────
// Distance & area
// ─────────────────────────────────────────────────────────────────────────────

float distanceSq(const cv::Point2f& a, const cv::Point2f& b) {
    float dx = a.x - b.x;
    float dy = a.y - b.y;
    return dx * dx + dy * dy;
}

float distance(const cv::Point2f& a, const cv::Point2f& b) {
    return std::sqrt(distanceSq(a, b));
}

float signedArea(const std::vector<cv::Point2f>& pts) {
    float area = 0.f;
    const int n = static_cast<int>(pts.size());
    for (int i = 0; i < n; ++i) {
        const auto& curr = pts[i];
        const auto& next = pts[(i + 1) % n];
        area += curr.x * next.y - next.x * curr.y;
    }
    return area * 0.5f;
}

float quadArea(const std::vector<cv::Point2f>& pts) {
    return std::abs(signedArea(pts));
}

// ─────────────────────────────────────────────────────────────────────────────
// Aspect ratio
// ─────────────────────────────────────────────────────────────────────────────

float quadAspectRatio(const std::vector<cv::Point2f>& c) {
    if (c.size() < 4) return 0.f;

    // Average opposite side lengths to reduce per-side noise
    float topSide    = distance(c[0], c[1]);
    float bottomSide = distance(c[3], c[2]);
    float leftSide   = distance(c[0], c[3]);
    float rightSide  = distance(c[1], c[2]);

    float avgWidth  = (topSide   + bottomSide) * 0.5f;
    float avgHeight = (leftSide  + rightSide)  * 0.5f;

    if (avgWidth < 1.f || avgHeight < 1.f) return 0.f;

    return (avgWidth > avgHeight)
        ? avgWidth  / avgHeight
        : avgHeight / avgWidth;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corner ordering
// ─────────────────────────────────────────────────────────────────────────────

std::vector<cv::Point2f> sortCornersClockwise(const std::vector<cv::Point2f>& pts) {
    if (pts.size() != 4) return pts;

    // Step 1: find centroid
    cv::Point2f centroid(0.f, 0.f);
    for (auto& p : pts) {
        centroid.x += p.x;
        centroid.y += p.y;
    }
    centroid.x /= 4.f;
    centroid.y /= 4.f;

    // Step 2: sort by angle from centroid (clockwise = decreasing angle in image coords
    // because Y-axis points DOWN in image coordinates)
    std::vector<std::pair<float, cv::Point2f>> anglePoint;
    for (auto& p : pts) {
        float angle = std::atan2(p.y - centroid.y, p.x - centroid.x);
        anglePoint.emplace_back(angle, p);
    }
    std::sort(anglePoint.begin(), anglePoint.end(),
        [](const auto& a, const auto& b) { return a.first < b.first; });

    // After angle-sort, order is: left(-π), top-left(-π/2 ish), right(0), bottom(+π/2 ish)
    // We want: top-left, top-right, bottom-right, bottom-left (clockwise in image)
    std::vector<cv::Point2f> sorted;
    sorted.reserve(4);
    for (auto& ap : anglePoint) sorted.push_back(ap.second);

    // Step 3: find top-left = minimum x+y (since image origin is top-left)
    int topLeftIdx = 0;
    float minSum = std::numeric_limits<float>::max();
    for (int i = 0; i < 4; ++i) {
        float s = sorted[i].x + sorted[i].y;
        if (s < minSum) {
            minSum    = s;
            topLeftIdx = i;
        }
    }

    // Rotate so top-left is first
    std::vector<cv::Point2f> result(4);
    for (int i = 0; i < 4; ++i) {
        result[i] = sorted[(topLeftIdx + i) % 4];
    }
    return result;
}

int findTopLeftIndex(const std::vector<cv::Point2f>& corners) {
    int idx = 0;
    float minSum = std::numeric_limits<float>::max();
    for (int i = 0; i < static_cast<int>(corners.size()); ++i) {
        float s = corners[i].x + corners[i].y;
        if (s < minSum) {
            minSum = s;
            idx    = i;
        }
    }
    return idx;
}

// ─────────────────────────────────────────────────────────────────────────────
// IoU
// ─────────────────────────────────────────────────────────────────────────────

cv::Rect boundingRect(const std::vector<cv::Point2f>& pts) {
    float minX = pts[0].x, maxX = pts[0].x;
    float minY = pts[0].y, maxY = pts[0].y;
    for (auto& p : pts) {
        minX = std::min(minX, p.x);
        maxX = std::max(maxX, p.x);
        minY = std::min(minY, p.y);
        maxY = std::max(maxY, p.y);
    }
    return cv::Rect(
        static_cast<int>(minX), static_cast<int>(minY),
        static_cast<int>(maxX - minX), static_cast<int>(maxY - minY)
    );
}

float iou(const cv::Rect& a, const cv::Rect& b) {
    cv::Rect intersection = a & b;
    if (intersection.area() <= 0) return 0.f;

    float interArea = static_cast<float>(intersection.area());
    float unionArea = static_cast<float>(a.area() + b.area()) - interArea;
    return (unionArea > 0.f) ? interArea / unionArea : 0.f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bit manipulation — 5×5 grid codes
// ─────────────────────────────────────────────────────────────────────────────

uint32_t rotate5x5_90cw(uint32_t code) {
    // 90° CW rotation of a 5×5 grid:
    //   new position of bit at (row, col) = (col, 4-row)
    //   old_bit_idx = row * 5 + col
    //   new_bit_idx = col * 5 + (4 - row)
    uint32_t rotated = 0;
    for (int row = 0; row < 5; ++row) {
        for (int col = 0; col < 5; ++col) {
            int oldIdx = row * 5 + col;
            int newRow = col;
            int newCol = 4 - row;
            int newIdx = newRow * 5 + newCol;
            if (code & (1u << oldIdx)) {
                rotated |= (1u << newIdx);
            }
        }
    }
    return rotated;
}

int hammingDistance(uint32_t a, uint32_t b) {
    // XOR produces 1-bits only where a and b differ; popcount counts them.
    // __builtin_popcount compiles to a single POPCNT instruction on ARMv8/x86_64.
    return __builtin_popcount(a ^ b);
}

} // namespace GeometryUtils
