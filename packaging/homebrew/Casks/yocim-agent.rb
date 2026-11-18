cask "yocim-agent" do
  arch arm: "arm64", intel: "x64"

  version "0.1.8"
  sha256 arm:   "b1e8f2009d40f6b046cce970c955f6c73ad8a3727f0b699092051e22c65c40ae",
         intel: "d6cb4cf0b102b8a4777095414624503b9a0f14e118fba7e9b0c3bfdc7b608646"

  url "https://github.com/YOCIM888/YOCIM-AGENT/releases/download/v#{version}/YOCIM.AGENT-#{version}-#{arch}.dmg"
  name "YOCIM AGENT"
  desc "Local-first desktop AI coding assistant"
  homepage "https://agent.yocim.top/"

  depends_on :macos

  app "YOCIM AGENT.app"

  zap :not_required
end
