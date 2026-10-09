# safe-install for VS Code

See the supply-chain risk of your dependencies where you edit them, and approve install
scripts yourself. A front end for the [safe-install](https://github.com/crossben/safe-install)
CLI: every check is done by the CLI you have installed; the extension only displays it.

Work in progress. Works in VS Code, Cursor, Windsurf and VSCodium.

## Develop

```sh
npm ci --ignore-scripts   # nothing here needs install scripts
npm run build      # dist/extension.js
npm run lint
npm run typecheck
npm test           # downloads a VS Code build once, runs it on test/fixtures/workspace
npm run package    # safe-install-<version>.vsix
```

## License

Apache-2.0
