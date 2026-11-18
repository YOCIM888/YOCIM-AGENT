# 内置 ripgrep

- 版本：14.1.1
- 来源：https://github.com/BurntSushi/ripgrep/releases/tag/14.1.1
- 许可：MIT OR Unlicense（见上游仓库 LICENSE-MIT / UNLICENSE）

二进制 `rg` / `rg.exe` **不提交进仓库**，由 GitHub Actions 在打包前从官方 release 下载到本目录：

- Windows：`x86_64-pc-windows-msvc` → `rg.exe`
- macOS x64：`x86_64-apple-darwin` → `rg`
- macOS arm64：`aarch64-apple-darwin` → `rg`
- Linux x64：`x86_64-unknown-linux-musl` → `rg`

本地开发若想启用 ripgrep 加速，可手动下载对应平台的二进制放到本目录（`.gitignore` 已忽略），
或设置 `YOCIM_RIPGREP_PATH` 指向已有 `rg`。缺失时 `findRipgrepPath()` 会回退到 PATH 里的 `rg` 或内置 JS 搜索。

打包由 `electron-builder.yml` 的 `extraResources` 放到 `resources/ripgrep/`。
升级时同步修改 `.github/workflows/package-*.yml` 的版本号与 target，并更新本文件。
