import path from 'path';
import sourcemaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import json from '@rollup/plugin-json';
import sizes from '@atomico/rollup-plugin-sizes';
import autoExternal from 'rollup-plugin-auto-external';

async function build(commandLineArgs) {
  const config = []
  // Support --scope and --ignore globs if passed in via commandline
  // const { scope, ignore, ci } = minimist(process.argv.slice(2))
  // const packages = await getSortedPackages(scope, ignore)

  // prevent rollup warning
  delete commandLineArgs.ci
  delete commandLineArgs.scope
  delete commandLineArgs.ignore

  const basePath = './';
  const input = path.join(basePath, 'src/index.ts')
  const name = "@workstream-app/extension-graphql";
  const exports = {
    "source": {
      "import": "./src"
    },
    "default": {
      "import": "./dist/extension-graphql.esm.js",
      "require": "./dist/extension-graphql.cjs"
    }
  };

  const basePlugins = [
    sourcemaps(),
    resolve(),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
    }),
    sizes(),
    json(),
  ];

  console.log('package', path.join(basePath, 'package.json'));

  config.push({
    // perf: true,
    input,
    output: [
      {
        name,
        file: path.join(basePath, exports.default.require),
        format: 'cjs',
        sourcemap: true,
        exports: 'auto',
      },
      {
        name,
        file: path.join(basePath, exports.default.import),
        format: 'es',
        sourcemap: true,
      },
    ],
    plugins: [
      autoExternal({
        // packagePath: path.join(basePath, './package.json'),
        // dependencies: true,
      }),
      ...basePlugins,
      typescript({
        tsconfigOverride: {
          compilerOptions: {
            declaration: true,
            // paths: {
            //   '@hocuspocus/*': ['./src'],
            // },
          },
          include: [],
        },
      }),
    ],
  })

  return config
}

export default build
