import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

// @todo this can probably be removed
const debugResolve = {
  resolveId (importee) {
    if (importee === '@y/stream') {
      return `${process.cwd()}/src/index.js`
    }
    return null
  }
}

export default [{
  input: './demo/demo.js',
  output: {
    name: 'test',
    file: 'dist/demo.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    debugResolve,
    nodeResolve({
      mainFields: ['module', 'browser', 'main']
    }),
    commonjs()
  ]
}]
