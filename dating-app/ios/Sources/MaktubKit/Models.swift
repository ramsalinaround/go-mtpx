import Foundation

// Wire models for docs/spec/02-api-contract.md. Decoded with
// .convertFromSnakeCase, so property names are the camelCase spellings of the
// contract's snake_case keys.

public struct APIErrorPayload: Decodable, Sendable {
    public let code: String
    public let message: String
    public let retryAfterS: Int?
}

struct APIErrorEnvelope: Decodable {
    let error: APIErrorPayload
}

public struct MaktubError: Error, Sendable {
    public let status: Int
    public let code: String
    public let message: String
    public let retryAfterS: Int?

    public init(status: Int, code: String, message: String, retryAfterS: Int? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.retryAfterS = retryAfterS
    }
}

public struct TokenPair: Decodable, Sendable {
    public let accessToken: String
    public let refreshToken: String
}

public struct VerifyResponse: Decodable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let user: Me
}

public struct PhotoURLs: Decodable, Sendable {
    // Opaque tokens; the client resolves them against its scene map and never
    // constructs URLs (contract rule).
    public let thumb: String
    public let card: String
    public let full: String
}

public struct MyPhoto: Decodable, Sendable, Identifiable {
    public let id: String
    public let urls: PhotoURLs
    public let moderationStatus: String
    public let reason: String?
}

public struct CandidatePhoto: Decodable, Sendable, Identifiable {
    public let id: String
    public let urls: PhotoURLs
}

public struct Profile: Decodable, Sendable {
    public let name: String?
    public let birthdate: String?
    public let gender: String?
    public let bio: String?
    public let interests: [String]?
    public let hueIndex: Int?
}

public struct Preferences: Decodable, Sendable {
    public let minAge: Int
    public let maxAge: Int
    public let maxDistanceKm: Int
    public let genders: [String]
    public let interests: [String]?
}

public struct Me: Decodable, Sendable {
    public let id: String
    public let phone: String?
    public let onboardingState: String
    public let profile: Profile
    public let preferences: Preferences?
    public let photos: [MyPhoto]
}

public struct Candidate: Decodable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let age: Int
    public let gender: String?
    public let distanceKm: Int
    public let job: String?
    public let bio: String?
    public let interests: [String]
    public let hueIndex: Int?
    public let photos: [CandidatePhoto]
}

public struct Message: Decodable, Sendable, Identifiable {
    public let id: String
    public let seq: Int
    public let matchId: String
    public let senderId: String
    public let body: String
    public let createdAt: String
    public let clientId: String?
}

public struct Match: Decodable, Sendable, Identifiable {
    public let id: String
    public let createdAt: String
    public let user: Candidate
    public let lastMessage: Message?
    public let unreadCount: Int
    public let theirLastReadSeq: Int
}

public struct FeedResponse: Decodable, Sendable {
    public let candidates: [Candidate]
    public let nextCursor: String?
}

public struct MatchesResponse: Decodable, Sendable {
    public let matches: [Match]
    public let nextCursor: String?
}

public struct MessagesResponse: Decodable, Sendable {
    public let messages: [Message]
    public let nextCursor: String?
}

public struct SwipeResponse: Decodable, Sendable {
    public let match: Match?
}

public struct PresignResponse: Decodable, Sendable {
    public let uploadUrl: String
    public let key: String
}

public enum ReportReason: String, CaseIterable, Sendable {
    case spamOrFake = "spam_or_fake"
    case inappropriateMessages = "inappropriate_messages"
    case inappropriatePhotos = "inappropriate_photos"
    case underage = "underage"
    case safetyConcern = "safety_concern"
    case other = "other"

    public var label: String {
        switch self {
        case .spamOrFake: return "Fake profile or spam"
        case .inappropriateMessages: return "Inappropriate messages"
        case .inappropriatePhotos: return "Inappropriate photos"
        case .underage: return "Underage or minor"
        case .safetyConcern: return "Made me feel unsafe"
        case .other: return "Other"
        }
    }
}

// MARK: - WebSocket frames

public enum ServerFrame: Sendable {
    case ping
    case messageNew(Message)
    case messageRead(matchId: String, lastMessageId: String, readerId: String)
    case matchNew(Match)
    case matchClosed(matchId: String, reason: String)
    case unknown(String)
}

struct FramePeek: Decodable {
    let type: String
}

struct FrameData<T: Decodable>: Decodable {
    let data: T
}

struct MessageReadData: Decodable {
    let matchId: String
    let lastMessageId: String
    let readerId: String
}

struct MatchClosedData: Decodable {
    let matchId: String
    let reason: String
}

public enum FrameDecoder {
    public static func decode(_ text: String) -> ServerFrame? {
        guard let raw = text.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let peek = try? decoder.decode(FramePeek.self, from: raw) else { return nil }
        switch peek.type {
        case "ping":
            return .ping
        case "message.new":
            guard let f = try? decoder.decode(FrameData<Message>.self, from: raw) else { return nil }
            return .messageNew(f.data)
        case "message.read":
            guard let f = try? decoder.decode(FrameData<MessageReadData>.self, from: raw) else { return nil }
            return .messageRead(matchId: f.data.matchId, lastMessageId: f.data.lastMessageId, readerId: f.data.readerId)
        case "match.new":
            guard let f = try? decoder.decode(FrameData<Match>.self, from: raw) else { return nil }
            return .matchNew(f.data)
        case "match.closed":
            guard let f = try? decoder.decode(FrameData<MatchClosedData>.self, from: raw) else { return nil }
            return .matchClosed(matchId: f.data.matchId, reason: f.data.reason)
        default:
            return .unknown(peek.type)
        }
    }
}
