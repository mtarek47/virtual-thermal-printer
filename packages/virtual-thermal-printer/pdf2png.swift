import Foundation
import PDFKit
import CoreGraphics
import ImageIO

guard CommandLine.arguments.count >= 3 else { exit(1) }
let pdfUrl = URL(fileURLWithPath: CommandLine.arguments[1])
let outUrl = URL(fileURLWithPath: CommandLine.arguments[2])
let targetWidth: Double = CommandLine.arguments.count >= 4 ? (Double(CommandLine.arguments[3]) ?? 600.0) : 600.0

guard let doc = PDFDocument(url: pdfUrl), let page = doc.page(at: 0) else { exit(2) }
let box = page.bounds(for: .mediaBox)
let scale = targetWidth / Double(box.width)
let width = Int(targetWidth)
let height = Int(Double(box.height) * scale)

let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { exit(3) }

ctx.interpolationQuality = .high
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
ctx.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: ctx)

guard let img = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(outUrl as CFURL, "public.png" as CFString, 1, nil) else { exit(4) }
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
