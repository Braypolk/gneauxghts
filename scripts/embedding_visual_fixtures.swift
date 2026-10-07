// Synthetic screenshot/diagram/small-text fixtures; no user data.
import AppKit
import Foundation
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 18, bold: Bool = false) {
  let attributes: [NSAttributedString.Key: Any] = [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.black]
  (value as NSString).draw(at: NSPoint(x:x,y:y), withAttributes: attributes)
}
func rect(_ x: CGFloat,_ y: CGFloat,_ w: CGFloat,_ h: CGFloat,_ color: NSColor) { color.setFill(); NSBezierPath(rect:NSRect(x:x,y:y,width:w,height:h)).fill() }
func line(_ x: CGFloat,_ y: CGFloat,_ a: CGFloat,_ b: CGFloat) { let p=NSBezierPath(); p.lineWidth=3; p.move(to:NSPoint(x:x,y:y));p.line(to:NSPoint(x:a,y:b));NSColor.darkGray.setStroke();p.stroke() }
let names=["privacy", "network", "search-diagram", "upload-diagram", "revenue-growth", "revenue-decline", "receipt-148", "receipt-418"]
for (i,name) in names.enumerated() {
 for variant in [false,true] {
  let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:600,pixelsHigh:400,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  let context=NSGraphicsContext(bitmapImageRep:bitmap)!
  NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=context
  rect(0,0,600,400,NSColor.white)
  if i < 2 {
   rect(0,350,600,50,variant ? .lightGray : NSColor(calibratedWhite:0.92,alpha:1));text("Application Settings",20,365,22,bold:true)
   rect(0,0,130,350,NSColor(calibratedWhite:0.96,alpha:1));text("General",15,310,14);text("Privacy",15,270,14);text("Network",15,230,14)
   text(i==0 ? "Privacy & Sharing" : "Network Connection",160,300,24,bold:true)
   text(i==0 ? "Public sharing" : "Proxy server",160,245,18);rect(480,245,60,22,.systemBlue)
   text(i==0 ? "Allow analytics" : "Offline mode",160,195,18);rect(480,195,60,22,.lightGray)
   text(i==0 ? "Private vaults remain on this device." : "Connect through the corporate proxy.",160,130,12)
  } else if i < 4 {
   text(i==2 ? "Search Architecture" : "Upload Pipeline",20,355,26,bold:true)
   let labels=i==2 ? ["Database","Cache","Search Index"] : ["Upload","Virus Scan","File Storage"]
   for j in 0..<3 { rect(CGFloat(20+j*195),185,170,90,variant ? .systemTeal : .systemBlue);text(labels[j],CGFloat(32+j*195),220,19,bold:true); if j<2 { line(CGFloat(190+j*195),230,CGFloat(210+j*195),230) } }
   text(i==2 ? "Queries retrieve indexed note passages." : "Files are scanned before storage.",30,105,16)
  } else if i < 6 {
   text("Quarterly Revenue",25,350,26,bold:true);line(60,65,60,310);line(60,65,555,65)
   text("Q1",65,30,16);text("Q2",205,30,16);text("Q3",355,30,16);text("Q4",505,30,16)
   let ys:[CGFloat]=i==4 ? [100,155,220,285] : [285,220,155,100]
   for j in 0..<3 { line(CGFloat(80+j*145),ys[j],CGFloat(80+(j+1)*145),ys[j+1]) }
   text(i==4 ? "Revenue increased each quarter." : "Revenue decreased each quarter.",100,320,14)
  } else {
   text("CORNER SHOP",175,345,28,bold:true);text("Receipt 2026-10-06",210,305,12)
   text("Coffee beans                          $24.50",120,245,11);text("Household supplies                $123.70",120,220,11)
   line(120,190,475,190);text(i==6 ? "TOTAL $148.20" : "TOTAL $418.20",135,145,32,bold:true)
   text(i==6 ? "Order #148 - Paid with card" : "Order #418 - Paid with card",180,110,10)
   text("Thank you for shopping with us.",175,55,10)
  }
  NSGraphicsContext.restoreGraphicsState()
  try bitmap.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent(name+(variant ? "-query" : "")+".png"))
 }
}
