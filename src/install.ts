/** How to install or update the CLI on this OS, as the README documents it. */
export interface InstallHint {
  readonly how: string;
  /** One command to copy, when there is one. */
  readonly command?: string;
}

export const RELEASES_URL = 'https://github.com/crossben/safe-install/releases/latest';
export const DOCS_URL = 'https://github.com/crossben/safe-install#get-it';

export function installHint(platform: NodeJS.Platform, update: boolean): InstallHint {
  switch (platform) {
    case 'darwin':
      return update
        ? { how: 'Homebrew', command: 'brew upgrade --cask safe-install' }
        : {
            how: 'Homebrew',
            command: 'brew tap crossben/safe-install https://github.com/crossben/safe-install && brew install --cask safe-install',
          };
    case 'win32':
      return update
        ? { how: 'Scoop', command: 'scoop update safe-install' }
        : {
            how: 'Scoop',
            command: 'scoop bucket add safe-install https://github.com/crossben/safe-install; scoop install safe-install',
          };
    default:
      return { how: `the .deb, .rpm or .apk from ${RELEASES_URL}, or Homebrew` };
  }
}
