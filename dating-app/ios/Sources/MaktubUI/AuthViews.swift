import SwiftUI
import MaktubKit

struct WelcomeView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            RoundedRectangle(cornerRadius: 26)
                .fill(LinearGradient(colors: [SceneArt.accent, Color.orange],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 84, height: 84)
                .overlay(Image(systemName: "heart.fill").font(.system(size: 38)).foregroundColor(.white))
            Text("maktub")
                .font(.system(size: 44, weight: .semibold, design: .serif))
            Text("Meet people who feel familiar.\nFewer swipes, better conversations.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
            Spacer()
            VStack(spacing: 10) {
                TextField("Server", text: $model.baseURLString)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.footnote, design: .monospaced))
                Button {
                    model.beginPhone()
                } label: {
                    Text("Continue with phone")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(SceneArt.accent)
            }
        }
        .padding(24)
    }
}

struct PhoneView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button("← Back") { model.route = .welcome }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
            Text("What's your number?")
                .font(.system(size: 30, weight: .semibold, design: .serif))
            Text("We'll text you a code — no passwords. Prototype: the code appears on screen.")
                .foregroundColor(.secondary)
            TextField("+13035551234", text: $model.phone)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
            if let err = model.errorMessage {
                Text(err).font(.footnote).foregroundColor(SceneArt.accent)
            }
            Button {
                Task { await model.sendCode() }
            } label: {
                Text(model.busy ? "Sending…" : "Send code")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(SceneArt.accent)
            .disabled(model.busy)
            Spacer()
        }
        .padding(24)
    }
}

struct OTPView: View {
    @ObservedObject var model: AppModel
    @State private var code = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button("← Back") { model.route = .phone }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
            Text("Enter the code")
                .font(.system(size: 30, weight: .semibold, design: .serif))
            Text("Sent to \(model.phone)")
                .foregroundColor(.secondary)
            TextField("123456", text: $code)
                .textFieldStyle(.roundedBorder)
                .font(.system(.title3, design: .monospaced))
            if let err = model.errorMessage {
                Text(err).font(.footnote).foregroundColor(SceneArt.accent)
            }
            Button {
                Task { await model.verifyCode(code) }
            } label: {
                Text(model.busy ? "Verifying…" : "Verify")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(SceneArt.accent)
            .disabled(model.busy)
            Button("Resend code") {
                Task { await model.sendCode() }
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)
            Spacer()
        }
        .padding(24)
    }
}

struct SetupView: View {
    @ObservedObject var model: AppModel
    @State private var name = ""
    @State private var birthdate = Calendar.current.date(byAdding: .year, value: -25, to: Date()) ?? Date()
    @State private var gender = "woman"
    @State private var showMe = "everyone"
    @State private var bio = ""
    @State private var picked: Set<String> = []
    @State private var localError: String?

    private var birthdateString: String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: birthdate)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Make it yours")
                    .font(.system(size: 30, weight: .semibold, design: .serif))
                Text("Your age is shown on your card — your birthdate never is.")
                    .foregroundColor(.secondary)
                TextField("First name", text: $name)
                    .textFieldStyle(.roundedBorder)
                DatePicker("Birthdate", selection: $birthdate, displayedComponents: .date)
                Picker("I am", selection: $gender) {
                    Text("Woman").tag("woman")
                    Text("Man").tag("man")
                    Text("Non-binary").tag("nonbinary")
                }
                Picker("Show me", selection: $showMe) {
                    Text("Everyone").tag("everyone")
                    Text("Women").tag("woman")
                    Text("Men").tag("man")
                    Text("Non-binary people").tag("nonbinary")
                }
                TextField("Bio", text: $bio, axis: .vertical)
                    .lineLimit(3...5)
                    .textFieldStyle(.roundedBorder)
                Text("Interests — pick at least 3")
                    .font(.footnote.weight(.bold))
                    .foregroundColor(.secondary)
                InterestGrid(picked: $picked)
                if let err = localError ?? model.errorMessage {
                    Text(err).font(.footnote).foregroundColor(SceneArt.accent)
                }
                Button {
                    if name.trimmingCharacters(in: .whitespaces).isEmpty {
                        localError = "Tell us your first name."
                    } else if picked.count < 3 {
                        localError = "Pick at least 3 interests."
                    } else {
                        localError = nil
                        Task {
                            await model.completeProfile(
                                name: name, birthdate: birthdateString, gender: gender,
                                showMe: showMe, bio: bio, interests: Array(picked))
                        }
                    }
                } label: {
                    Text(model.busy ? "Setting up…" : "Start matching")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(SceneArt.accent)
                .disabled(model.busy)
            }
            .padding(24)
        }
    }
}

struct InterestGrid: View {
    @Binding var picked: Set<String>

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
            ForEach(kInterests, id: \.self) { interest in
                let on = picked.contains(interest)
                Button {
                    if on {
                        picked.remove(interest)
                    } else {
                        picked.insert(interest)
                    }
                } label: {
                    Text(interest)
                        .font(.footnote.weight(on ? .bold : .regular))
                        .padding(.vertical, 7)
                        .frame(maxWidth: .infinity)
                        .background(on ? SceneArt.accent.opacity(0.16) : Color.secondary.opacity(0.08))
                        .foregroundColor(on ? SceneArt.accent : .primary)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}
