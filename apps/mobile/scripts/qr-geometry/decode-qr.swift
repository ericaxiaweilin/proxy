// Step 3 of the QR geometry verification: the decode oracle.
//
// macOS ships a QR detector (CoreImage). We use it to PROVE a rendered code still
// scans, rather than assuming the styling is safe.
//
// usage: swift decode-qr.swift <png>...        (exit 0 = all decoded)

import Foundation
import CoreImage

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty {
    FileHandle.standardError.write("usage: decode-qr <png>...\n".data(using: .utf8)!)
    exit(2)
}

let detector = CIDetector(
    ofType: CIDetectorTypeQRCode,
    context: nil,
    options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
)

var failures = 0
for path in args {
    guard let image = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
        print("\((path as NSString).lastPathComponent): CANNOT LOAD")
        failures += 1
        continue
    }
    let features = detector?.features(in: image) as? [CIQRCodeFeature] ?? []
    let payloads = features.compactMap { $0.messageString }
    if payloads.isEmpty {
        print("\((path as NSString).lastPathComponent): NOT DECODABLE")
        failures += 1
    } else {
        for p in payloads {
            print("\((path as NSString).lastPathComponent): OK \(p)")
        }
    }
}
exit(failures == 0 ? 0 : 1)
