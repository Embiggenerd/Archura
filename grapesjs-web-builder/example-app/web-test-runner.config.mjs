import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  nodeResolve: true,
  files: ['test/BuilderHeroLit.component.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [
    esbuildPlugin({
      ts: true,
      target: 'auto',
      tsconfig: 'tsconfig.json'
    })
  ],
  testFramework: {
    config: {
      ui: 'tdd',
      timeout: 5000
    }
  }
};
