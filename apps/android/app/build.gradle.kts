plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.subvocal.radar"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.subvocal.radar"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // signed with the debug key so the APK installs directly; use your own key for distribution
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// No libraries in the app: it only uses Android framework APIs. JUnit runs the decoder parity test.
dependencies {
    testImplementation("junit:junit:4.13.2")
}
