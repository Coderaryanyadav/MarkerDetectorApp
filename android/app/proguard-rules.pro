# Add project-specific ProGuard rules here.

# ── React Native ──────────────────────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# ── Vision Camera ─────────────────────────────────────────────────────────────
-keep class com.mrousavy.camera.** { *; }
-keepclassmembers class com.mrousavy.camera.** { *; }

# ── OpenCV (native lib — keep JNI boundary) ───────────────────────────────────
-keep class org.opencv.** { *; }
-keepclassmembers class org.opencv.** { *; }

# ── Our native module ─────────────────────────────────────────────────────────
-keep class com.markerdetectorapp.opencv.** { *; }
-keepclassmembers class com.markerdetectorapp.opencv.MarkerDetectorModule {
    public *;
    private native *;
}

# ── Kotlin ────────────────────────────────────────────────────────────────────
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**

# ── Reanimated ────────────────────────────────────────────────────────────────
-keep class com.swmansion.reanimated.** { *; }
-keep class com.worklets.** { *; }

# ── General Android ───────────────────────────────────────────────────────────
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes Signature
-keepattributes Exceptions
