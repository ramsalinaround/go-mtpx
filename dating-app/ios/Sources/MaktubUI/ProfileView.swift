import SwiftUI
import MaktubKit

struct ProfileView: View {
    @ObservedObject var model: AppModel
    @State private var bio = ""
    @State private var picked: Set<String> = []
    @State private var loaded = false
    @State private var confirmDelete = false

    private func age(from birthdate: String?) -> String {
        guard let birthdate else { return "" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: birthdate) else { return "" }
        let years = Calendar.current.dateComponents([.year], from: date, to: Date()).year ?? 0
        return ", \(years)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let me = model.me {
                    HStack(spacing: 14) {
                        AvatarView(name: me.profile.name ?? "?",
                                   hueIndex: me.profile.hueIndex, size: 64)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(me.profile.name ?? "You")\(age(from: me.profile.birthdate))")
                                .font(.system(.title2, design: .serif).weight(.semibold))
                            Text(me.phone ?? "").font(.footnote).foregroundColor(.secondary)
                        }
                    }
                    Text("BIO").font(.caption.weight(.bold)).foregroundColor(.secondary)
                    TextField("Bio", text: $bio, axis: .vertical)
                        .lineLimit(3...5)
                        .textFieldStyle(.roundedBorder)
                    Text("INTERESTS").font(.caption.weight(.bold)).foregroundColor(.secondary)
                    InterestGrid(picked: $picked)
                    Button {
                        Task { await model.saveProfile(bio: bio, interests: Array(picked)) }
                    } label: {
                        Text("Save changes").frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                    .disabled(picked.count < 3)

                    Divider().padding(.vertical, 6)
                    Button {
                        Task { await model.logout() }
                    } label: {
                        Text("Log out").frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Text("Delete account").frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                    Text("Deletion is permanent and not the same as logging out.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(16)
        }
        .onAppear {
            guard !loaded, let me = model.me else { return }
            loaded = true
            bio = me.profile.bio ?? ""
            picked = Set(me.profile.interests ?? [])
        }
        .confirmationDialog(
            "Delete your account? This permanently deletes your profile, matches, and messages.",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Permanently delete", role: .destructive) {
                Task { await model.deleteAccount() }
            }
        }
    }
}
