package com.markerdetectorapp.opencv

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

/**
 * MarkerDetectorPackage — registers the native module and frame processor plugin.
 * Referenced in MainApplication.kt.
 */
class MarkerDetectorPackage : ReactPackage {

    init {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("markerDetector") { proxy, options ->
            MarkerDetectorFrameProcessorPlugin(proxy, options)
        }
    }

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(MarkerDetectorModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
