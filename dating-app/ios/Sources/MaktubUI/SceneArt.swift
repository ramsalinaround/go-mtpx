import SwiftUI
import MaktubKit

// Photo URLs in API responses are opaque scene tokens (contract: never construct
// URLs). The native client resolves them here, mirroring the web client's
// PHOTO_SCENES map with SwiftUI gradients.

public enum SceneArt {
    public static func gradient(for token: String) -> LinearGradient {
        let colors: [Color]
        switch token {
        case "sunset":
            colors = [Color(red: 0.97, green: 0.70, blue: 0.40),
                      Color(red: 0.96, green: 0.52, blue: 0.37),
                      Color(red: 0.36, green: 0.22, blue: 0.30)]
        case "coast":
            colors = [Color(red: 0.66, green: 0.85, blue: 0.86),
                      Color(red: 0.50, green: 0.75, blue: 0.83),
                      Color(red: 0.91, green: 0.83, blue: 0.67)]
        case "forest":
            colors = [Color(red: 0.50, green: 0.69, blue: 0.41),
                      Color(red: 0.24, green: 0.49, blue: 0.31),
                      Color(red: 0.12, green: 0.27, blue: 0.20)]
        case "city":
            colors = [Color(red: 0.56, green: 0.60, blue: 0.69),
                      Color(red: 0.36, green: 0.40, blue: 0.49),
                      Color(red: 0.20, green: 0.25, blue: 0.36)]
        case "cafe":
            colors = [Color(red: 0.84, green: 0.64, blue: 0.45),
                      Color(red: 0.66, green: 0.44, blue: 0.27),
                      Color(red: 0.42, green: 0.25, blue: 0.14)]
        case "mountain":
            colors = [Color(red: 0.86, green: 0.91, blue: 0.96),
                      Color(red: 0.64, green: 0.73, blue: 0.83),
                      Color(red: 0.23, green: 0.31, blue: 0.41)]
        case "studio":
            colors = [Color(red: 0.85, green: 0.75, blue: 0.72),
                      Color(red: 0.60, green: 0.55, blue: 0.60)]
        case "lowlight":
            colors = [Color(red: 0.17, green: 0.13, blue: 0.20),
                      Color(red: 0.09, green: 0.07, blue: 0.12)]
        default:
            colors = [Color(red: 0.55, green: 0.35, blue: 0.45),
                      Color(red: 0.35, green: 0.22, blue: 0.32)]
        }
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
    }

    static let huePairs: [(Double, Double)] = [
        (338, 24), (262, 200), (16, 340), (152, 190), (206, 258), (42, 8),
    ]

    public static func hueGradient(index: Int?) -> LinearGradient {
        let pair = huePairs[abs(index ?? 0) % huePairs.count]
        let a = Color(hue: pair.0 / 360.0, saturation: 0.62, brightness: 0.80)
        let b = Color(hue: pair.1 / 360.0, saturation: 0.70, brightness: 0.88)
        return LinearGradient(colors: [a, b], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    public static let accent = Color(red: 0.85, green: 0.23, blue: 0.39)
}

public struct AvatarView: View {
    let name: String
    let hueIndex: Int?
    var size: CGFloat = 44

    public init(name: String, hueIndex: Int?, size: CGFloat = 44) {
        self.name = name
        self.hueIndex = hueIndex
        self.size = size
    }

    public var body: some View {
        ZStack {
            Circle().fill(SceneArt.hueGradient(index: hueIndex))
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.42, weight: .semibold, design: .serif))
                .foregroundColor(.white)
        }
        .frame(width: size, height: size)
    }
}
