module.exports = {
  dependencies: {
    // Disabled on Android: this version references vision-camera APIs
    // (VisionCameraProxy / FrameProcessorPlugin / Orientation) that don't exist
    // in the installed react-native-vision-camera, so its Kotlin fails to
    // compile. It is not imported anywhere in the JS yet. When the AI
    // face-capture feature is actually wired up, install a face-detector version
    // that matches the installed vision-camera and remove this entry.
    'react-native-vision-camera-face-detector': {
      platforms: { android: null },
    },
  },
};
