# 包管理器清单

这里存放 YOCIM AGENT 的第三方包管理器清单。所有地址和 SHA-256 都指向同一个 GitHub Release，官网「安装方式」页直接链接到本目录。

## 当前状态

| 渠道          | 清单                            | 安装方式                                                                                                               | 官方源状态（2026-11-18 核查）                         |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| winget        | `winget/YOCIM.YOCIMAGENT.yaml`  | 本地清单：`winget install --manifest .\YOCIM.YOCIMAGENT.yaml`                                                          | `microsoft/winget-pkgs` 尚无条目；需按清单规范提交 PR |
| Homebrew Cask | `homebrew/Casks/yocim-agent.rb` | 本地 cask：`brew install --cask ./yocim-agent.rb`                                                                      | `Homebrew/homebrew-cask` 尚无条目；需提交 PR          |
| Scoop         | `scoop/yocim-agent.json`        | 直接 URL：`scoop install https://raw.githubusercontent.com/YOCIM888/YOCIM-AGENT/main/packaging/scoop/yocim-agent.json` | 可由用户直接按 URL 安装；也可再向 bucket 提交 PR      |

清单对应版本：**0.1.8**。

## v0.1.8 资产校验值

| 资产                                | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `YOCIM.AGENT-0.1.8-x64-setup.exe`   | `CI 构建后回填`                                                    |
| `YOCIM.AGENT-0.1.8-arm64.dmg`       | `CI 构建后回填`                                                    |
| `YOCIM.AGENT-0.1.8-x64.dmg`         | `CI 构建后回填`                                                    |
| `YOCIM.AGENT-0.1.8-x86_64.AppImage` | `CI 构建后回填`                                                    |

## 发版时更新

1. Release 资产齐全后，用 `gh release view vX.Y.Z --json assets` 取得下载名与 `digest`。
2. 更新三份清单中的 `PackageVersion` / `version`、`InstallerUrl` / `url`、`Sha256` / `hash`。
3. 用 `winget install --manifest <file>`（需先 `winget settings --enable LocalManifestFiles`）、`brew install --cask ./yocim-agent.rb`、`scoop install <manifest-url>` 各做一次本地安装验证。
4. 若官方源已收录，向对应仓库提交版本更新 PR；winget 的 `PackageIdentifier` 固定为 `YOCIM.YOCIMAGENT`，Homebrew cask token 固定为 `yocim-agent`。

## 注意事项

- winget 清单使用 `nullsoft` 安装器类型与 `/S` 静默参数；安装包当前未签名，SmartScreen 提示处理见官网 FAQ。
- Homebrew cask 为 arm64 / x64 分别提供 dmg 校验值；构建未公证，首次打开需右键选择「打开」。
- Scoop 清单用 `#/dl.7z` 让 Scoop 解包 NSIS 安装包，避免安装器向 Scoop 目录外写文件；`post_install` 清理 `$PLUGINSDIR` 与卸载残留。
