import 'dotenv/config';

export default {
  "expo": {
    "name": "Fire/Gas Leak Monitoring",
    "slug": "h-fireresidentmonitoring",
    "owner": "hfiremaker",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/h-fire_logo.png",
    "scheme": "hfire",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "updates": {
      "url": "https://u.expo.dev/0d1a5ce6-68ef-487a-9efe-25a61a61f8b2"
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
        "foregroundImage": "./assets/images/h-fire_logo.png",
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
      "expo-updates",
      "expo-notifications",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/h-fire_logo.png",
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
        "projectId": "0d1a5ce6-68ef-487a-9efe-25a61a61f8b2"
      },
      "clerkProxyUrl": "https://valued-vulture-7.clerk.accounts.dev"
    }
  }
};
