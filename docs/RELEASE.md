# Release

1. Bump `version` in `package.json`.
2. Run `npm run typecheck` and `npm run build`.
3. Tag the release:
   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. The `Publish to npm` workflow publishes automatically after setting the `NPM_TOKEN` secret.
