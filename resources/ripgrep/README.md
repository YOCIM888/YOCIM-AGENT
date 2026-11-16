# 内置 ripgrep

- 版本：14.1.1（x86_64-pc-windows-msvc，含 PCRE2）
- 来源：https://github.com/BurntSushi/ripgrep/releases/tag/14.1.1
- 许可：MIT OR Unlicense（见上游仓库 LICENSE-MIT / UNLICENSE）
- 打包：`electron-builder.yml` 的 `extraResources` 把它放到 `resources/ripgrep/rg.exe`，主进程 `findRipgrepPath()` 优先使用该文件，缺失时回退 PATH 里的 `rg` 或内置 JS 搜索。

升级时替换 `rg.exe` 并同步本文件的版本号。非 Windows 平台需放同名的 `rg` 二进制。
