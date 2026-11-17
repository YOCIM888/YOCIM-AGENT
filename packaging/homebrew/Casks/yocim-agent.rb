cask "yocim-agent" do
  arch arm: "arm64", intel: "x64"

  version "0.1.6"
  sha256 arm:   "1f1fa061dfb57e4d17ca6a6cdd302045a3f2738431f2eda3ca92c348bda69925",
         intel: "fb2d7706d0bfa2d87afa0e19bebde7b64799fb2216faef31bb1c454d5ad0cfa1"

  url "https://github.com/YOCIM888/YOCIM-AGENT/releases/download/v#{version}/YOCIM.AGENT-#{version}-#{arch}.dmg"
  name "YOCIM AGENT"
  desc "Local-first desktop AI coding assistant"
  homepage "https://agent.yocim.top/"

  depends_on :macos

  app "YOCIM AGENT.app"

  zap :not_required
end
