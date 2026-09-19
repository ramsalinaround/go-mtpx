import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// WebSocket client for /v1/ws?token=… per the contract: frame shape
// {type, data, client_id?}; replies to server pings with pong; reconnects with
// exponential backoff (1s -> 30s cap, jittered). Decoded server frames are
// published on an AsyncStream; call connect(token:) again after a token refresh.

public final class SocketClient: @unchecked Sendable {
    public let frames: AsyncStream<ServerFrame>
    private let continuation: AsyncStream<ServerFrame>.Continuation

    private let baseURL: URL
    private let session: URLSession
    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?
    private var wantConnected = false
    private var currentToken: String?
    private var backoffMs = 1000

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        var cont: AsyncStream<ServerFrame>.Continuation!
        self.frames = AsyncStream { c in cont = c }
        self.continuation = cont
    }

    private func wsURL(token: String) -> URL? {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else { return nil }
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/v1/ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        return comps.url
    }

    public func connect(token: String) {
        lock.lock()
        wantConnected = true
        currentToken = token
        let old = task
        task = nil
        lock.unlock()
        old?.cancel(with: .goingAway, reason: nil)
        open()
    }

    /// Ends the connection AND the frame stream; use one SocketClient per session.
    public func disconnect() {
        lock.lock()
        wantConnected = false
        currentToken = nil
        let old = task
        task = nil
        lock.unlock()
        old?.cancel(with: .goingAway, reason: nil)
        continuation.finish()
    }

    private func open() {
        lock.lock()
        guard wantConnected, let token = currentToken, let url = wsURL(token: token) else {
            lock.unlock()
            return
        }
        let t = session.webSocketTask(with: url)
        task = t
        lock.unlock()
        t.resume()
        receiveLoop(on: t)
    }

    private func receiveLoop(on t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.scheduleReconnect(failed: t)
            case .success(let message):
                self.lock.lock()
                self.backoffMs = 1000 // healthy connection resets the backoff
                self.lock.unlock()
                if case .string(let text) = message, let frame = FrameDecoder.decode(text) {
                    if case .ping = frame {
                        t.send(.string(#"{"type":"pong"}"#)) { _ in }
                    } else {
                        self.continuation.yield(frame)
                    }
                }
                self.receiveLoop(on: t)
            }
        }
    }

    private func scheduleReconnect(failed: URLSessionWebSocketTask) {
        lock.lock()
        if task === failed { task = nil }
        guard wantConnected else {
            lock.unlock()
            return
        }
        let delay = backoffMs
        backoffMs = min(backoffMs * 2, 30000)
        lock.unlock()
        let jitter = Int.random(in: 0...300)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay + jitter) * 1_000_000)
            self?.open()
        }
    }

    /// client -> server frame; returns false when there is no live socket
    /// (caller should use the REST fallback).
    @discardableResult
    public func send(type: String, data: [String: Any]) -> Bool {
        lock.lock()
        let t = task
        lock.unlock()
        guard let t else { return false }
        let frame: [String: Any] = ["type": type, "data": data]
        guard let bytes = try? JSONSerialization.data(withJSONObject: frame),
              let text = String(data: bytes, encoding: .utf8) else { return false }
        t.send(.string(text)) { _ in }
        return true
    }
}
