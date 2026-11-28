import SwiftUI
import PulseKit

/// Sound panel (web "sound panel"): 10-band EQ with the 15 presets and preamp, speed with pitch
/// lock, crossfade, leveler, fade on pause, volume.
struct SoundSheet: View {
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        @Bindable var player = player
        NavigationStack {
            Form {
                Section {
                    Toggle("Equalizer", isOn: $player.settings.eqEnabled)
                    Picker("Preset", selection: Binding(get: { player.settings.eqPreset }, set: { player.setEQPreset($0) })) {
                        ForEach(EQBands.presets, id: \.name) { Text($0.name).tag($0.name) }
                        if EQBands.gains(forPreset: player.settings.eqPreset) == nil { Text("Custom").tag(player.settings.eqPreset) }
                    }
                    EQBandsView(gains: $player.settings.eqGains, onEdit: { player.settings.eqPreset = "Custom" })
                        .disabled(!player.settings.eqEnabled)
                        .opacity(player.settings.eqEnabled ? 1 : 0.45)
                    LabeledSlider(title: "Preamp", value: $player.settings.preamp, range: -12...12, format: { String(format: "%+.0f dB", $0) })
                        .disabled(!player.settings.eqEnabled)
                }
                Section("Playback") {
                    LabeledSlider(title: "Speed", value: $player.settings.speed, range: PlaybackSettings.speedRange, step: 0.05,
                                  format: { String(format: "%.2f×", $0) })
                    Toggle("Keep pitch when changing speed", isOn: $player.settings.keepPitch)
                    LabeledSlider(title: "Crossfade", value: Binding(get: { Float(player.settings.crossfade) }, set: { player.settings.crossfade = Double($0) }),
                                  range: 0...12, step: 1, format: { $0 == 0 ? "Off (gapless)" : "\(Int($0)) s" })
                    Toggle("Volume leveler", isOn: $player.settings.leveler)
                    Toggle("Fade on pause / play", isOn: $player.settings.fadeOnPause)
                }
                Section("Volume") {
                    LabeledSlider(title: "Pulse volume", value: Binding(get: { player.settings.volume }, set: { player.setVolume($0) }),
                                  range: 0...1, format: { "\(Int($0 * 100))%" })
                    LabeledContent("Output", value: player.outputName)
                }
            }
            .navigationTitle("Sound")
            .navigationBarTitleDisplayMode(.inline)
            .scrollContentBackground(.hidden)
        }
    }
}

/// Ten vertical sliders, drawn as draggable bars (SwiftUI has no vertical Slider).
struct EQBandsView: View {
    @Binding var gains: [Float]
    var onEdit: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(EQBands.frequencies.indices, id: \.self) { i in
                VStack(spacing: 6) {
                    GeometryReader { geo in
                        let h = geo.size.height
                        let g = gains.indices.contains(i) ? gains[i] : 0
                        let y = h / 2 - CGFloat(g / 12) * (h / 2)
                        ZStack(alignment: .top) {
                            Capsule().fill(.white.opacity(0.1)).frame(width: 4).frame(maxWidth: .infinity)
                            Rectangle().fill(.tint).frame(width: 4, height: abs(y - h / 2))
                                .offset(y: min(y, h / 2)).frame(maxWidth: .infinity)
                            Circle().fill(.white).frame(width: 16, height: 16).offset(y: y - 8)
                        }
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                            let raw = Float((h / 2 - v.location.y) / (h / 2)) * 12
                            if gains.indices.contains(i) { gains[i] = (min(max(raw, -12), 12) * 2).rounded() / 2 }
                            onEdit()
                        })
                    }
                    .frame(height: 150)
                    Text(EQBands.label(for: EQBands.frequencies[i])).font(.system(size: 9).monospacedDigit()).foregroundStyle(.secondary)
                }
                .accessibilityElement()
                .accessibilityLabel("\(EQBands.label(for: EQBands.frequencies[i])) hertz")
                .accessibilityValue(String(format: "%+.1f decibels", gains.indices.contains(i) ? gains[i] : 0))
                .accessibilityAdjustableAction { dir in
                    guard gains.indices.contains(i) else { return }
                    gains[i] = min(12, max(-12, gains[i] + (dir == .increment ? 1 : -1))); onEdit()
                }
            }
        }
        .padding(.vertical, 6)
    }
}

struct LabeledSlider: View {
    let title: String
    @Binding var value: Float
    let range: ClosedRange<Float>
    var step: Float?
    let format: (Float) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(title); Spacer(); Text(format(value)).foregroundStyle(.secondary).monospacedDigit() }
            if let step { Slider(value: $value, in: range, step: step) } else { Slider(value: $value, in: range) }
        }
    }
}
