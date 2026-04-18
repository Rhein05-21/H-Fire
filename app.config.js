import 'dotenv/config';

export default {
  "expo": {
    "name": "H-Fire: Fire/Gas Leak Monitoring System",
    "slug": "h-fireresidentmonitor",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/H-Fire _logo.png",
    "scheme": "hfire",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "updates": {
      "url": "https://u.expo.dev/7e955f47-b77e-4f62-8949-51ad7e53911f"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    },
    "ios": {
      "supportsTablet": true,
      "config": {
        "googleMapsApiKey": process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
      }
    },
    "android": {
      "package": "com.tigle.hfire",
      "adaptiveIcon": {
        "backgroundColor": "#121212",
        "foregroundImage": "./assets/images/H-Fire _logo.png",
        "backgroundImage": "./assets/images/android-icon-background.png",
        "monochromeImage": "./assets/images/android-icon-monochrome.png"
      },
      "edgeToEdgeEnabled": true,
      "predictiveBackGestureEnabled": false,
      "config": {
        "googleMaps": {
          "apiKey": process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
        }
      }
    },
    "web": {
      "output": "static",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/H-Fire _logo.png",
          "imageWidth": 300,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff",
          "dark": {
            "backgroundColor": "#151718"
          }
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    },
    "extra": {
      "eas": {
        "projectId": "7e955f47-b77e-4f62-8949-51ad7e53911f"
      }
    }
  }
};
