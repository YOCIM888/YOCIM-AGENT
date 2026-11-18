cask "yocim-agent" do
  arch arm: "arm64", intel: "x64"

  version "0.1.8"
  sha256 arm:   "9c507d8ec4a70e8b8ef420488a6db7cb688436cc9a424f92eb7ad4d231a486a2",
         intel: "6b9e30721883f5c299f5f89e1da4f928fbe1ec46d7e676b525e004d804b019bc"

  url "https://github.com/YOCIM888/YOCIM-AGENT/releases/download/v#{version}/YOCIM.AGENT-#{version}-#{arch}.dmg"
  name "YOCIM AGENT"
  desc "Local-first desktop AI coding assistant"
  homepage "https://agent.yocim.top/"

  depends_on :macos

  app "YOCIM AGENT.app"

  zap :not_required
end
