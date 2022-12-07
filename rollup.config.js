import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

export default [{
  input: './tests/index.js',
  output: {
    file: './dist/index.js',
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    resolve({ mainFields: ['browser', 'main'] }),
    commonjs()
  ]
}, {
  input: './tests/index.js',
  output: {
    file: './dist/test.cjs',
    format: 'cjs',
    sourcemap: true
  },
  external: ['isomorphic.js']
}]
