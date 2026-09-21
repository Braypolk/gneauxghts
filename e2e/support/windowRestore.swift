import AppKit
import CoreGraphics
import Foundation

// Observe WindowServer from before process creation: connecting WebDriver after
// startup cannot detect a default-size frame that has already disappeared.
let binary = CommandLine.arguments[1]
let root = URL(fileURLWithPath: CommandLine.arguments[2])
guard let screen = NSScreen.main else { fatalError("An unlocked macOS display is required") }
let scale = screen.backingScaleFactor

func checkLaunch(_ name: String, width: Double, height: Double, saved: Bool) throws {
    let fixture = root.appendingPathComponent(name)
    let data = fixture.appendingPathComponent("app-data")
    try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
    if saved {
        let state: [String: Any] = ["main": [
            "width": Int(width * scale), "height": Int(height * scale),
            "x": Int(60 * scale), "y": Int(60 * scale),
            "prev_x": Int(60 * scale), "prev_y": Int(60 * scale),
            "maximized": false, "visible": false, "decorated": true, "fullscreen": false
        ]]
        try JSONSerialization.data(withJSONObject: state)
            .write(to: data.appendingPathComponent(".window-state.json"))
    }
    let child = Process()
    child.executableURL = URL(fileURLWithPath: binary)
    child.arguments = [
        "--e2e-app-data-root", data.path,
        "--e2e-documents-root", fixture.appendingPathComponent("documents").path,
        "--e2e-vault-root", fixture.appendingPathComponent("vault").path
    ]
    child.standardOutput = FileHandle.standardError
    child.standardError = FileHandle.standardError
    try child.run()
    defer {
        // This probe owns only this disposable process; it never quits the user's app.
        if child.isRunning { kill(child.processIdentifier, SIGKILL); child.waitUntilExit() }
    }
    let start = Date()
    var firstVisible: Date?
    var frames: [CGRect] = []
    while Date().timeIntervalSince(start) < 30 && child.isRunning {
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        for window in windows where
            (window[kCGWindowOwnerPID as String] as? Int32) == child.processIdentifier &&
            (window[kCGWindowLayer as String] as? Int) == 0 {
            guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary), frame.width > 100 else { continue }
            if firstVisible == nil { firstVisible = Date() }
            if frames.last != frame { frames.append(frame) }
        }
        if let first = firstVisible, Date().timeIntervalSince(first) > 2 { break }
        Thread.sleep(forTimeInterval: 0.005)
    }
    print("WINDOW_RESTORE \(name): \(frames)")
    guard let first = frames.first else { throw NSError(domain: name, code: 1,
        userInfo: [NSLocalizedDescriptionKey: "No visible window appeared"]) }
    guard frames.allSatisfy({ abs($0.width - width) <= 2 && abs($0.height - height) <= 2 &&
        abs($0.minX - first.minX) <= 2 && abs($0.minY - first.minY) <= 2 }) else {
        throw NSError(domain: name, code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Window changed bounds while visible or restored the wrong size"])
    }
    if saved && (abs(first.minX - 60) > 2 || abs(first.minY - 60) > 2) {
        throw NSError(domain: name, code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Saved position was not restored"])
    }
}

do {
    try checkLaunch("saved-smaller", width: 980, height: 700, saved: true)
    try checkLaunch("saved-larger", width: min(1380, screen.visibleFrame.width - 100),
                    height: min(850, screen.visibleFrame.height - 100), saved: true)
    try checkLaunch("first-launch", width: 1200, height: 800, saved: false)
} catch {
    print("WINDOW_RESTORE_FAILED: \(error.localizedDescription)")
    exit(1)
}
