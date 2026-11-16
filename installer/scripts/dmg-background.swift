import AppKit
import CoreText

// Finder supplies the window, real app icons and drag behaviour. Keep the
// artwork transparent so its native light/dark background remains visible.
let destination = CommandLine.arguments[1]
let preview = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
let width: CGFloat = 640, height: CGFloat = 400
let muted = NSColor(white: 0.50, alpha: 1)
func text(_ value: String, _ point: NSPoint, _ size: CGFloat, _ weight: NSFont.Weight = .regular) {
    (value as NSString).draw(at: point, withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: muted])
}
func artwork() {
    let mark = NSBezierPath(); mark.lineWidth = 2.5
    for (a,b) in [(NSPoint(x:42,y:31),NSPoint(x:42,y:47)),(NSPoint(x:35.1,y:35),NSPoint(x:48.9,y:43)),(NSPoint(x:35.1,y:43),NSPoint(x:48.9,y:35))] { mark.move(to:a);mark.line(to:b) }
    muted.setStroke(); mark.stroke()
    text("devyy", NSPoint(x:58,y:28), 17, .medium)
    text("Install Devyy", NSPoint(x:34,y:82), 27, .medium)
    text("Drag Devyy to Applications.", NSPoint(x:35,y:121), 13)
    let arrow=NSBezierPath();arrow.lineWidth=1.3;arrow.lineCapStyle = .round
    arrow.move(to:NSPoint(x:301,y:235));arrow.line(to:NSPoint(x:339,y:235))
    arrow.move(to:NSPoint(x:332,y:228));arrow.line(to:NSPoint(x:339,y:235));arrow.line(to:NSPoint(x:332,y:242));muted.setStroke();arrow.stroke()
    text("When the copy finishes, open Devyy from Applications.", NSPoint(x:35,y:358), 11)
}
func png(_ image:NSImage,_ path:String) throws {
    let rep=NSBitmapImageRep(data:image.tiffRepresentation!)!
    try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:path))
}
let image=NSImage(size:NSSize(width:width,height:height));image.lockFocusFlipped(true)
NSColor.clear.setFill();NSBezierPath(rect:NSRect(x:0,y:0,width:width,height:height)).fill();artwork();image.unlockFocus()
try png(image,destination)

// An explicit layout preview, not a captured Finder window. Used when macOS
// Screen Recording access is unavailable. Uses the actual bundled app icon.
if let app=preview {
    for dark in [false,true] {
        let result=NSImage(size:NSSize(width:width,height:height));result.lockFocusFlipped(true)
        NSColor(white:dark ? 0.12 : 0.98,alpha:1).setFill();NSBezierPath(rect:NSRect(x:0,y:0,width:width,height:height)).fill();artwork()
        let appURL=URL(fileURLWithPath:app)
        let info=NSDictionary(contentsOf:appURL.appendingPathComponent("Contents/Info.plist"))!
        let iconFile=info["CFBundleIconFile"] as! String
        let iconURL=appURL.appendingPathComponent("Contents/Resources").appendingPathComponent(iconFile.hasSuffix(".icns") ? iconFile : iconFile+".icns")
        let appIcon=NSImage(contentsOf:iconURL)!
        let folder=NSWorkspace.shared.icon(forFile:"/Applications")
        appIcon.draw(in:NSRect(x:126,y:187,width:88,height:88),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
        folder.draw(in:NSRect(x:426,y:187,width:88,height:88),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
        let color=NSColor(white:dark ? 0.9 : 0.15,alpha:1)
        for (name,center) in [("Devyy",CGFloat(170)),("Applications",CGFloat(470))] {
            let attr:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:12),.foregroundColor:color]
            let size=(name as NSString).size(withAttributes:attr)
            (name as NSString).draw(at:NSPoint(x:center-size.width/2,y:285),withAttributes:attr)
        }
        result.unlockFocus()
        let output=URL(fileURLWithPath:destination).deletingLastPathComponent().appendingPathComponent("devyy-installer-macos-\(dark ? "dark" : "light")-preview.png").path
        try png(result,output)
    }
}
