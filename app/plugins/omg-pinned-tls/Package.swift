// swift-tools-version: 5.9
import PackageDescription

// The package and library names must equal the Capacitor CLI's `fixName("omg-pinned-tls")`,
// which `npx cap sync` writes into ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "OmgPinnedTls",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "OmgPinnedTls",
            targets: ["PinnedTlsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "PinnedTlsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/PinnedTlsPlugin")
    ]
)
