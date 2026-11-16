import AppKit
let directory=CommandLine.arguments[1]
for (name,color) in [("mark-dark",NSColor(white:0.95,alpha:1)),("mark-light",NSColor(white:0.12,alpha:1))] {
 let image=NSImage(size:NSSize(width:128,height:128));image.lockFocusFlipped(true)
 NSColor.clear.setFill();NSBezierPath(rect:NSRect(x:0,y:0,width:128,height:128)).fill()
 let path=NSBezierPath();path.lineWidth=16;path.lineCapStyle = .butt
 for pair in [(NSPoint(x:64,y:24),NSPoint(x:64,y:104)),(NSPoint(x:29.4,y:44),NSPoint(x:98.6,y:84)),(NSPoint(x:29.4,y:84),NSPoint(x:98.6,y:44))]{path.move(to:pair.0);path.line(to:pair.1)}
 color.setStroke();path.stroke();image.unlockFocus()
 let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
 try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:directory+"/"+name+".png"))
}
