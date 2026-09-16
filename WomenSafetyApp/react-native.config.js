module.exports = {
  dependencies: {
    // Disabled on Android: the installed face-detector (1.7.2) targets an older
    // vision-camera API and fails to compile against the installed
    // vision-camera. Enabling AI face-capture requires aligning a compatible
    // trio — react-native-vision-camera (>=5.0.10) +
    // react-native-vision-camera-face-detector (2.1.x) + a newer
    // react-native-nitro-modules that provides <NitroModules/ReactProp.hpp> —
    // and testing on a physical device. Do that in a device-connected session,
    // then remove this entry.
    'react-native-vision-camera-face-detector': {
      platforms: { android: null },
    },
  },
};
