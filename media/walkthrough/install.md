# Install the safe-install CLI

The extension shows what the **safe-install** command-line tool finds; it does no checking
of its own. Install the CLI once:

```sh
# macOS / Linux (Homebrew)
brew tap crossben/safe-install https://github.com/crossben/safe-install
brew install --cask safe-install

# Windows (Scoop)
scoop bucket add safe-install https://github.com/crossben/safe-install
scoop install safe-install

# Debian / Ubuntu, Fedora / RHEL, Alpine: the .deb / .rpm / .apk from the latest release
```

If it is not on your `PATH`, set `safeInstall.path` in your **user** settings. A
workspace can never change that setting, so a repository cannot make the extension run a
binary of its choosing.
