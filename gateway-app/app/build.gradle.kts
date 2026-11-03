plugins {
    id("com.android.application")
}

val gatewayPrivateKey = System.getenv("GATEWAY_PRIVATE_KEY_B64") ?: ""

android {
    namespace = "com.kkomasub.geminigateway"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kkomasub.geminigateway"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SERVER_BASE_URL", "\"https://gemini-chat-no-wifi.pages.dev\"")
        buildConfigField("String", "GATEWAY_PRIVATE_KEY_B64", "\"" + gatewayPrivateKey + "\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    implementation("com.klinkerapps:android-smsmms:5.2.6")
}
