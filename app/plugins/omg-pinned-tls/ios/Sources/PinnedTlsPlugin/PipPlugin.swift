import Foundation
import Capacitor
import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import UIKit

// OmgPip (experimental): shows the remote display in the system's Picture in Picture window.
// JS side: app/src/ui/session/pipFeed.ts.
//
// The session's picture is drawn by the web layer, which iOS cannot float by itself. The web
// layer sends JPEG frames here; they are shown on an AVSampleBufferDisplayLayer, which is
// what AVPictureInPictureController floats. The window is view-only (iOS passes no touches).
// It starts when the user leaves the app (`canStartPictureInPictureAutomaticallyFromInline`)
// or from `start`, which JS calls only from a tap.
//
// Lives in this package so that no second local package has to be wired into the app. Only
// the plugin class may carry an Objective-C name annotation with a parenthesised name (see
// PinnedTlsPlugin.swift).

@objc(PipPlugin)
public class PipPlugin: CAPPlugin, CAPBridgedPlugin, AVPictureInPictureControllerDelegate,
    AVPictureInPictureSampleBufferPlaybackDelegate {
    public let identifier = "PipPlugin"
    public let jsName = "OmgPip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    // Everything below is touched on the main thread only.
    private var hostView: UIView?
    private var displayLayer: AVSampleBufferDisplayLayer?
    private var controller: AVPictureInPictureController?
    private var possibleObservation: NSKeyValueObservation?
    private var framesShown = 0
    private var framesInBackground = 0
    /// Seconds this app's own code ran while in the background (a 1 Hz native timer): tells
    /// "the whole app was suspended" apart from "the app ran but the web layer did not".
    private var nativeSecondsInBackground = 0
    private var heartbeat: Timer?
    private var lastError = ""

    // MARK: - JS methods

    /// Creates the hidden video layer and the Picture in Picture controller. Idempotent.
    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard AVPictureInPictureController.isPictureInPictureSupported() else {
                call.resolve(["supported": false])
                return
            }
            if self.controller == nil { self.setUp() }
            call.resolve(self.statusObject())
        }
    }

    /// One JPEG frame (base64, no data-URL prefix).
    @objc func frame(_ call: CAPPluginCall) {
        guard let b64 = call.getString("jpeg"), let data = Data(base64Encoded: b64),
              let image = UIImage(data: data)?.cgImage else {
            call.reject("A base64 JPEG is required")
            return
        }
        DispatchQueue.main.async {
            guard let layer = self.displayLayer else {
                call.resolve(["shown": false])
                return
            }
            if layer.status == .failed {
                self.lastError = layer.error?.localizedDescription ?? "layer failed"
                layer.flush()
            }
            guard let sample = PipPlugin.sampleBuffer(from: image) else {
                call.resolve(["shown": false])
                return
            }
            layer.enqueue(sample)
            self.framesShown += 1
            if UIApplication.shared.applicationState == .background { self.framesInBackground += 1 }
            call.resolve(["shown": true])
        }
    }

    /// Opens the window now. Call only from a tap: Apple rejects apps that start it unasked.
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.controller else {
                call.reject("Not prepared")
                return
            }
            if !controller.isPictureInPictureActive { controller.startPictureInPicture() }
            call.resolve(self.statusObject())
        }
    }

    /// Closes the window and removes the layer.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tearDown()
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.statusObject()) }
    }

    // MARK: - Set-up

    private func setUp() {
        guard let parent = bridge?.viewController?.view else { return }
        // Picture in Picture needs the playback category. Mixing keeps the user's music going.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            lastError = "audio session: \(error.localizedDescription)"
        }

        // The layer has to be in the view hierarchy. It sits behind the web content, which
        // covers it: only the floating window ever shows these frames.
        let host = UIView(frame: CGRect(x: 0, y: 0, width: 160, height: 90))
        host.isUserInteractionEnabled = false
        host.backgroundColor = .black
        let layer = AVSampleBufferDisplayLayer()
        layer.frame = host.bounds
        layer.videoGravity = .resizeAspect
        host.layer.addSublayer(layer)
        parent.insertSubview(host, at: 0)
        hostView = host
        displayLayer = layer

        let source = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: layer, playbackDelegate: self)
        let pip = AVPictureInPictureController(contentSource: source)
        pip.delegate = self
        pip.canStartPictureInPictureAutomaticallyFromInline = true
        // A live picture: no skip buttons.
        pip.requiresLinearPlayback = true
        controller = pip
        heartbeat = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            if UIApplication.shared.applicationState == .background {
                self?.nativeSecondsInBackground += 1
            }
        }
        possibleObservation = pip.observe(\.isPictureInPicturePossible, options: [.new]) {
            [weak self] _, _ in
            DispatchQueue.main.async { self?.emit("possible") }
        }
    }

    private func tearDown() {
        heartbeat?.invalidate()
        heartbeat = nil
        possibleObservation?.invalidate()
        possibleObservation = nil
        if let controller = controller, controller.isPictureInPictureActive {
            controller.stopPictureInPicture()
        }
        controller = nil
        displayLayer?.flushAndRemoveImage()
        displayLayer = nil
        hostView?.removeFromSuperview()
        hostView = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func statusObject() -> [String: Any] {
        return [
            "supported": AVPictureInPictureController.isPictureInPictureSupported(),
            "prepared": controller != nil,
            "possible": controller?.isPictureInPicturePossible ?? false,
            "active": controller?.isPictureInPictureActive ?? false,
            "frames": framesShown,
            "framesInBackground": framesInBackground,
            "nativeSecondsInBackground": nativeSecondsInBackground,
            "audioCategory": AVAudioSession.sharedInstance().category.rawValue,
            "inWindow": hostView?.window != nil,
            "error": lastError
        ]
    }

    private func emit(_ event: String) {
        var data = statusObject()
        data["event"] = event
        notifyListeners("state", data: data)
    }

    // MARK: - Frames

    /// A displayable sample from a decoded image: BGRA pixel buffer, shown immediately.
    private static func sampleBuffer(from image: CGImage) -> CMSampleBuffer? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        let attrs: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as [String: Any]
        ]
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
                                  attrs as CFDictionary, &pixelBuffer) == kCVReturnSuccess,
              let buffer = pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        let drawn: Bool = {
            guard let context = CGContext(
                data: CVPixelBufferGetBaseAddress(buffer),
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                    | CGBitmapInfo.byteOrder32Little.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }()
        CVPixelBufferUnlockBaseAddress(buffer, [])
        guard drawn else { return nil }

        var format: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &format) == noErr,
              let description = format else { return nil }
        var timing = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
            decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescription: description,
            sampleTiming: &timing, sampleBufferOut: &sample) == noErr,
              let result = sample else { return nil }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(result, createIfNecessary: true),
           CFArrayGetCount(attachments) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(
                dict,
                Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return result
    }

    // MARK: - AVPictureInPictureControllerDelegate

    public func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        emit("started")
    }

    public func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        emit("stopped")
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        lastError = error.localizedDescription
        emit("failed")
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        emit("restore")
        completionHandler(true)
    }

    // MARK: - AVPictureInPictureSampleBufferPlaybackDelegate (a live picture, never paused)

    public func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {}

    public func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
        return CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }

    public func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool {
        return false
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime,
        completion completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
