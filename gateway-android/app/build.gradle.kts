plugins { id("com.android.application") }

android {
    namespace = "com.kkomasub.privategateway"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kkomasub.privategateway"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.klinkerapps:android-smsmms:5.2.6")
}
