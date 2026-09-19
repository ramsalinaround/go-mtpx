import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// REST client for the contract. Owns the token pair; on a 401 `token_expired`
// it refreshes once (rotating pair) and replays the request; a failed refresh
// surfaces `sessionExpired` so the caller can wipe the session (contract rule).

public actor APIClient {
    public enum ClientError: Error, Sendable {
        case sessionExpired
        case transport(String)
        case badResponse
    }

    public let baseURL: URL
    private let session: URLSession
    private var accessToken: String?
    private var refreshToken: String?

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func setTokens(access: String?, refresh: String?) {
        accessToken = access
        refreshToken = refresh
    }

    public func currentTokens() -> (access: String?, refresh: String?) {
        (accessToken, refreshToken)
    }

    private static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    // MARK: - core request machinery

    private func rawRequest(
        _ method: String, _ path: String, json: [String: Any]?, authorized: Bool
    ) async throws -> (Int, Data) {
        guard let url = URL(string: "/v1" + path, relativeTo: baseURL) else {
            throw ClientError.transport("bad path \(path)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let json {
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized, let accessToken {
            req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, resp): (Data, URLResponse)
        do {
            (data, resp) = try await session.data(for: req)
        } catch {
            throw ClientError.transport(String(describing: error))
        }
        guard let http = resp as? HTTPURLResponse else { throw ClientError.badResponse }
        return (http.statusCode, data)
    }

    private func errorFrom(status: Int, data: Data) -> Error {
        if let env = try? Self.decoder().decode(APIErrorEnvelope.self, from: data) {
            return MaktubError(
                status: status, code: env.error.code,
                message: env.error.message, retryAfterS: env.error.retryAfterS)
        }
        return MaktubError(status: status, code: "unknown", message: "Request failed (\(status))")
    }

    private func refresh() async throws {
        guard let refreshToken else { throw ClientError.sessionExpired }
        let (status, data) = try await rawRequest(
            "POST", "/auth/refresh", json: ["refresh_token": refreshToken], authorized: false)
        guard status == 200,
              let pair = try? Self.decoder().decode(TokenPair.self, from: data) else {
            self.accessToken = nil
            self.refreshToken = nil
            throw ClientError.sessionExpired
        }
        self.accessToken = pair.accessToken
        self.refreshToken = pair.refreshToken
    }

    /// Performs a request; returns (status, body). Retries once through a token
    /// refresh when the server answers 401 token_expired.
    public func send(
        _ method: String, _ path: String,
        json: [String: Any]? = nil, authorized: Bool = true
    ) async throws -> (Int, Data) {
        let (status, data) = try await rawRequest(method, path, json: json, authorized: authorized)
        if status >= 200 && status < 300 { return (status, data) }
        let err = errorFrom(status: status, data: data)
        if authorized, status == 401,
           let mErr = err as? MaktubError, mErr.code == "token_expired", refreshToken != nil {
            try await refresh()
            let (status2, data2) = try await rawRequest(method, path, json: json, authorized: authorized)
            if status2 >= 200 && status2 < 300 { return (status2, data2) }
            throw errorFrom(status: status2, data: data2)
        }
        throw err
    }

    public func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        let (_, data) = try await send("GET", path)
        return try Self.decoder().decode(T.self, from: data)
    }

    // MARK: - contract endpoints

    public func requestOTP(phone: String) async throws {
        _ = try await send("POST", "/otp/request", json: ["phone": phone], authorized: false)
    }

    @discardableResult
    public func verifyOTP(phone: String, code: String) async throws -> VerifyResponse {
        let (_, data) = try await send(
            "POST", "/otp/verify", json: ["phone": phone, "code": code], authorized: false)
        let resp = try Self.decoder().decode(VerifyResponse.self, from: data)
        accessToken = resp.accessToken
        refreshToken = resp.refreshToken
        return resp
    }

    public func logout() async {
        let token = refreshToken
        accessToken = nil
        refreshToken = nil
        if let token {
            _ = try? await rawRequest("POST", "/auth/logout", json: ["refresh_token": token], authorized: false)
        }
    }

    public func registerDevice(pushToken: String) async throws {
        _ = try await send("POST", "/devices", json: ["push_token": pushToken, "platform": "ios"])
    }

    public func me() async throws -> Me {
        try await get("/me", as: Me.self)
    }

    public func patchProfile(_ fields: [String: Any]) async throws {
        _ = try await send("PATCH", "/me/profile", json: fields)
    }

    public func putPreferences(
        minAge: Int, maxAge: Int, maxDistanceKm: Int, genders: [String], interests: [String] = []
    ) async throws {
        _ = try await send("PUT", "/me/preferences", json: [
            "min_age": minAge, "max_age": maxAge, "max_distance_km": maxDistanceKm,
            "genders": genders, "interests": interests,
        ])
    }

    public func putLocation(lat: Double, lon: Double) async throws {
        _ = try await send("PUT", "/me/location", json: ["lat": lat, "lon": lon])
    }

    public func feed(limit: Int = 25) async throws -> FeedResponse {
        try await get("/feed?limit=\(limit)", as: FeedResponse.self)
    }

    public func swipe(targetId: String, direction: String, clientId: String = UUID().uuidString) async throws -> Match? {
        let (_, data) = try await send("POST", "/swipes", json: [
            "target_id": targetId, "direction": direction, "client_id": clientId,
        ])
        return try Self.decoder().decode(SwipeResponse.self, from: data).match
    }

    public func matches() async throws -> [Match] {
        try await get("/matches", as: MatchesResponse.self).matches
    }

    public func unmatch(matchId: String) async throws {
        _ = try await send("DELETE", "/matches/\(matchId)")
    }

    public func messages(matchId: String, limit: Int = 50, before: String? = nil) async throws -> MessagesResponse {
        var path = "/matches/\(matchId)/messages?limit=\(limit)"
        if let before { path += "&before=\(before)" }
        return try await get(path, as: MessagesResponse.self)
    }

    /// REST fallback for message.send when the socket is down.
    @discardableResult
    public func sendMessage(matchId: String, body: String, clientId: String) async throws -> Message {
        let (_, data) = try await send("POST", "/matches/\(matchId)/messages", json: [
            "body": body, "client_id": clientId,
        ])
        return try Self.decoder().decode(Message.self, from: data)
    }

    public func markRead(matchId: String, lastMessageId: String) async throws {
        _ = try await send("POST", "/matches/\(matchId)/read", json: ["last_message_id": lastMessageId])
    }

    public func block(userId: String) async throws {
        _ = try await send("POST", "/blocks", json: ["user_id": userId])
    }

    public func report(userId: String, reason: ReportReason, detail: String? = nil) async throws {
        var json: [String: Any] = ["user_id": userId, "reason": reason.rawValue]
        if let detail { json["detail"] = detail }
        _ = try await send("POST", "/reports", json: json)
    }

    public func deleteAccount() async throws {
        _ = try await send("DELETE", "/me")
        accessToken = nil
        refreshToken = nil
    }

    public func requestExport() async throws {
        _ = try await send("POST", "/me/export")
    }

    // MARK: - photos (presign -> binary PUT -> confirm)

    public func presignPhoto(contentType: String = "image/jpeg") async throws -> PresignResponse {
        let (_, data) = try await send("POST", "/me/photos/presign", json: ["content_type": contentType])
        return try Self.decoder().decode(PresignResponse.self, from: data)
    }

    public func uploadPhoto(uploadUrl: String, bytes: Data) async throws {
        guard let url = URL(string: uploadUrl, relativeTo: baseURL) else {
            throw ClientError.transport("bad upload url")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.httpBody = bytes
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw ClientError.badResponse
        }
    }

    @discardableResult
    public func confirmPhoto(key: String) async throws -> MyPhoto {
        let (_, data) = try await send("POST", "/me/photos/confirm", json: ["key": key])
        return try Self.decoder().decode(MyPhoto.self, from: data)
    }

    public func reorderPhotos(orderedIds: [String]) async throws {
        _ = try await send("PATCH", "/me/photos/order", json: ["ordered_ids": orderedIds])
    }

    public func deletePhoto(id: String) async throws {
        _ = try await send("DELETE", "/me/photos/\(id)")
    }
}
