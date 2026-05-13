package com.markerdetectorapp.opencv

import android.graphics.BitmapFactory
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * MarkerDetectorModule — React Native bridge for the OpenCV C++ engine.
 *
 * Updated for Phase 3: adds nativeGetDebugData for contour visualization.
 *
 * JNI function contract (must match MarkerDetector.cpp extern "C" signatures):
 *   nativeInit(marker1, marker2) → Long (handle)
 *   nativeDetect(handle, yuv, w, h) → FloatArray([detected, markerId, confidence, x0,y0...x3,y3])
 *   nativeGetDebugData(handle) → FloatArray (contour visualization data)
 *   nativeRelease(handle)
 */
class MarkerDetectorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME                 = "MarkerDetectorModule"
        const val EVENT_MARKER_DETECTED = "onMarkerDetected"

        private var staticHandle: Long = 0L

        fun getNativeHandle(): Long = staticHandle

        init {
            System.loadLibrary("marker_detector")
        }

        @JvmStatic
        external fun nativeDetect(handle: Long, yuvData: ByteArray,
                                  width: Int, height: Int): FloatArray
    }

    private var nativeHandle: Long 
        get() = staticHandle
        set(value) { staticHandle = value }

    override fun getName(): String = NAME

    // ── JNI declarations ─────────────────────────────────────────────────────
    private external fun nativeInit(marker1: android.graphics.Bitmap,
                                    marker2: android.graphics.Bitmap): Long
    private external fun nativeGetDebugData(handle: Long): FloatArray
    private external fun nativeRelease(handle: Long)

    // ── React Native API ──────────────────────────────────────────────────────

    @ReactMethod
    fun isActive(promise: Promise) {
        promise.resolve(staticHandle != 0L)
    }

    @ReactMethod
    fun initialize(marker1Path: String, marker2Path: String, promise: Promise) {
        try {
            val assets = reactContext.assets
            val bm1 = BitmapFactory.decodeStream(assets.open(marker1Path))
                ?: return promise.reject("LOAD_ERROR", "Cannot decode marker1: $marker1Path")
            val bm2 = BitmapFactory.decodeStream(assets.open(marker2Path))
                ?: return promise.reject("LOAD_ERROR", "Cannot decode marker2: $marker2Path")

            nativeHandle = nativeInit(bm1, bm2)
            bm1.recycle()
            bm2.recycle()

            if (nativeHandle == 0L) {
                return promise.reject("INIT_ERROR", "Native detector init returned null handle")
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INIT_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun detectFrame(yuvData: ReadableArray, width: Int, height: Int, promise: Promise) {
        if (nativeHandle == 0L) {
            return promise.reject("NOT_INITIALIZED", "Call initialize() first")
        }
        try {
            val bytes = ByteArray(yuvData.size()) { i -> yuvData.getInt(i).toByte() }
            val raw   = nativeDetect(nativeHandle, bytes, width, height)

            val map = Arguments.createMap()
            if (raw.isEmpty() || raw[0] < 0.5f) {
                map.putBoolean("detected",   false)
                map.putInt("markerId",       -1)
                map.putDouble("confidence",  0.0)
                map.putNull("corners")
            } else {
                map.putBoolean("detected",   true)
                map.putInt("markerId",       raw[1].toInt())
                map.putDouble("confidence",  raw[2].toDouble())
                val corners = Arguments.createArray()
                for (i in 0 until 4) {
                    val pt = Arguments.createMap()
                    pt.putDouble("x", raw[3 + i * 2].toDouble())
                    pt.putDouble("y", raw[4 + i * 2].toDouble())
                    corners.pushMap(pt)
                }
                map.putArray("corners", corners)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DETECT_ERROR", e.message, e)
        }
    }

    /**
     * Get debug contour data for HUD overlay visualization.
     * Decodes the float array produced by nativeGetDebugData.
     *
     * Returns a map:
     *   candidateCount: Int
     *   candidates: Array<Array<{x, y}>>   — blue overlay quads
     *   hasFinal: Boolean
     *   finalCorners: Array<{x, y}>         — green overlay quad
     */
    @ReactMethod
    fun getDebugData(promise: Promise) {
        if (nativeHandle == 0L) {
            return promise.reject("NOT_INITIALIZED", "Call initialize() first")
        }
        try {
            val raw = nativeGetDebugData(nativeHandle)
            val map = Arguments.createMap()

            if (raw.size < 3) {
                map.putInt("candidateCount", 0)
                promise.resolve(map)
                return
            }

            map.putInt("candidateCount", raw[0].toInt())
            val numCandidateContours = raw[1].toInt()
            map.putInt("allContourCount", raw[2].toInt())

            // Parse candidate contours
            val candidatesArray = Arguments.createArray()
            var offset = 3
            for (c in 0 until numCandidateContours) {
                if (offset >= raw.size) break
                val numPts = raw[offset++].toInt()
                val contour = Arguments.createArray()
                for (p in 0 until numPts) {
                    if (offset + 1 >= raw.size) break
                    val pt = Arguments.createMap()
                    pt.putDouble("x", raw[offset++].toDouble())
                    pt.putDouble("y", raw[offset++].toDouble())
                    contour.pushMap(pt)
                }
                candidatesArray.pushArray(contour)
            }
            map.putArray("candidates", candidatesArray)

            // Parse final corners
            if (offset < raw.size) {
                val hasFinal = raw[offset++] > 0.5f
                map.putBoolean("hasFinal", hasFinal)
                val finalCorners = Arguments.createArray()
                for (i in 0 until 4) {
                    if (offset + 1 >= raw.size) break
                    val pt = Arguments.createMap()
                    pt.putDouble("x", raw[offset++].toDouble())
                    pt.putDouble("y", raw[offset++].toDouble())
                    finalCorners.pushMap(pt)
                }
                map.putArray("finalCorners", finalCorners)
            }

            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DEBUG_ERROR", e.message, e)
        }
    }

    fun emitDetectionEvent(markerId: Int, confidence: Float) {
        val params = Arguments.createMap()
        params.putInt("markerId", markerId)
        params.putDouble("confidence", confidence.toDouble())
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_MARKER_DETECTED, params)
    }

    @ReactMethod fun addListener(eventName: String) { /* Required by RCT */ }
    @ReactMethod fun removeListeners(count: Int)    { /* Required by RCT */ }

    override fun invalidate() {
        super.invalidate()
        if (nativeHandle != 0L) {
            nativeRelease(nativeHandle)
            nativeHandle = 0L
        }
    }
}
