cmake_minimum_required(VERSION 3.22.1)
project("MarkerDetectorJNI" CXX)

# ──────────────────────────────────────────────────────────────────────────────
# OpenCV Configuration
# Download SDK: https://opencv.org/releases/ → opencv-4.9.0-android-sdk.zip
# Set OPENCV_ANDROID_SDK to the extracted directory path.
# ──────────────────────────────────────────────────────────────────────────────
set(OPENCV_ANDROID_SDK "${CMAKE_SOURCE_DIR}/../../../../../opencv-android-sdk"
    CACHE PATH "Path to OpenCV Android SDK")

set(OpenCV_DIR "${OPENCV_ANDROID_SDK}/sdk/native/jni")
find_package(OpenCV REQUIRED COMPONENTS
    core
    imgproc
    calib3d
    features2d
)

if(NOT OpenCV_FOUND)
    message(FATAL_ERROR
        "OpenCV not found at ${OpenCV_DIR}.\n"
        "1. Download OpenCV Android SDK from https://opencv.org/releases/\n"
        "2. Extract to a local directory\n"
        "3. Pass -DOPENCV_ANDROID_SDK=/path/to/sdk when building, or\n"
        "   update the path in CMakeLists.txt")
endif()

message(STATUS "OpenCV ${OpenCV_VERSION} found at ${OpenCV_DIR}")

# ──────────────────────────────────────────────────────────────────────────────
# Source files — one per pipeline stage for clear separation of concerns
# ──────────────────────────────────────────────────────────────────────────────
add_library(
    marker_detector
    SHARED

    # JNI entry point — orchestrates the full 12-step pipeline
    MarkerDetector.cpp

    # Step 1–3: Preprocessing (YUV→Gray, Gaussian blur, adaptive threshold)
    ImageProcessor.cpp

    # Steps 4–6: Contour analysis, polygon approximation, candidate filtering
    FeatureExtractor.cpp          # implements ContourAnalyzer namespace

    # Steps 9–12: Perspective warp, code extraction, orientation, confidence
    HomographyUtils.cpp           # implements PerspectiveProcessor namespace

    # Steps 7–8: Structural validation and false positive rejection
    MarkerValidator.cpp

    # Step 8 deep structural checks (border thickness, hierarchy, white-space, asymmetry)
    MarkerStructureValidator.cpp

    # Shared geometry utilities (distances, IoU, bit rotation, corner sorting)
    GeometryUtils.cpp
)

# ──────────────────────────────────────────────────────────────────────────────
# Include directories
# ──────────────────────────────────────────────────────────────────────────────
target_include_directories(marker_detector PRIVATE
    ${OpenCV_INCLUDE_DIRS}
    ${CMAKE_CURRENT_SOURCE_DIR}/include    # Our headers: DetectorTypes.h, etc.
)

# ──────────────────────────────────────────────────────────────────────────────
# System libraries
# ──────────────────────────────────────────────────────────────────────────────
find_library(log-lib   log)          # __android_log_print
find_library(android-lib android)    # ANativeWindow, AndroidBitmap

target_link_libraries(marker_detector
    ${OpenCV_LIBS}       # OpenCV core, imgproc, calib3d, features2d
    ${log-lib}           # Android logging (used in all pipeline stages)
    ${android-lib}       # Android platform (AndroidBitmap_getInfo etc.)
    jnigraphics          # Bitmap pixel access from JNI
    z                    # zlib (OpenCV PNG/JPEG dependency)
)

# ──────────────────────────────────────────────────────────────────────────────
# Compiler configuration
# ──────────────────────────────────────────────────────────────────────────────
target_compile_features(marker_detector PRIVATE cxx_std_17)

target_compile_options(marker_detector PRIVATE
    # Release: max speed + disable assertions
    $<$<CONFIG:Release>:-O3 -DNDEBUG -fvisibility=hidden>

    # Debug: no optimization, assertions enabled
    $<$<CONFIG:Debug>:-O0 -DDEBUG>

    # Always: fast math (safe for CV), ARM NEON SIMD (auto-vectorization)
    -ffast-math
    -funroll-loops

    # Strict warnings to catch bugs early
    -Wall
    -Wextra
    -Wno-unused-parameter    # OpenCV headers trigger these
)

# ARM NEON SIMD acceleration (significant speedup for image processing on ARM)
# NEON is always available on arm64-v8a (no flag needed).
# For armeabi-v7a, -mfpu=neon enables NEON auto-vectorization.
if(ANDROID_ABI STREQUAL "armeabi-v7a")
    target_compile_options(marker_detector PRIVATE -mfpu=neon)
endif()
