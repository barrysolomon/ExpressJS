import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/public/instrumentation.js',
  output: {
    file: 'src/public/bundle/instrumentation.bundle.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    resolve({
      browser: true
    }),
    commonjs()
  ]
}; 